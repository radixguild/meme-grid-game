// POST /api/csp-report — the sink for next.config.ts's report-only CSP.
//
// The route accepts both report shapes, logs one line with no IP, no query
// string and no body echo, caps the body at 8kb, stores nothing, and is not
// served on GET.
process.env.DB_PATH = ":memory:";
process.env.RADIX_NETWORK = "mainnet";

import { describe, it, before, after, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { createApp as CreateApp } from "../../app";
import { getDb, closeDb } from "../../db/connection";
import { runMigrations } from "../../db/migrations/runner";
import { blockedUri, documentPath, MAX_REPORT_BYTES } from "../csp-report";

let baseUrl = "";
let server: ReturnType<ReturnType<typeof CreateApp>["listen"]>;
let logged: string[] = [];
let ipCounter = 0;

// A fresh documentation-range IP per request: every POST in this file would
// otherwise share one 60 POST/min bucket in middleware/rate-limit.ts.
function nextIp(): string {
  ipCounter++;
  return `198.51.100.${ipCounter}`;
}

function post(body: string, contentType: string, ip = nextIp()): Promise<Response> {
  return fetch(`${baseUrl}/api/csp-report`, {
    method: "POST",
    headers: { "Content-Type": contentType, "X-Forwarded-For": ip },
    body,
  });
}

const LEGACY = {
  "csp-report": {
    "document-uri": "https://memegrid.radixguild.com/play?session=SECRET-DOC#frag",
    referrer: "https://referrer.example/?ref=SECRET-REF",
    "violated-directive": "script-src-elem",
    "effective-directive": "script-src-elem",
    "original-policy": "default-src 'self'; ORIGINAL-POLICY-MARKER",
    disposition: "report",
    "blocked-uri": "https://evil.example/x.js?token=SECRET-BLOCKED",
    "line-number": 12,
    "source-file": "https://memegrid.radixguild.com/_next/static/chunk.js?v=SECRET-SRC",
    "script-sample": "SCRIPT-SAMPLE-MARKER",
  },
};

const REPORTING_API = [
  {
    type: "csp-violation",
    age: 10,
    url: "https://memegrid.radixguild.com/shop?x=SECRET-URL",
    user_agent: "UA-MARKER",
    body: {
      documentURL: "https://memegrid.radixguild.com/shop?x=SECRET-URL",
      effectiveDirective: "connect-src",
      blockedURL: "wss://relay.example/socket?token=SECRET-WSS",
      disposition: "report",
      originalPolicy: "ORIGINAL-POLICY-MARKER",
      sample: "SCRIPT-SAMPLE-MARKER",
    },
  },
  {
    type: "csp-violation",
    body: { documentURL: "https://memegrid.radixguild.com/", effectiveDirective: "img-src", blockedURL: "data" },
  },
];

/** Every row count, plus SQLite's per-connection write counter. */
function dbFingerprint(): string {
  const db = getDb();
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  const counts = tables.map(({ name }) => {
    const { n } = db.prepare(`SELECT COUNT(*) AS n FROM "${name}"`).get() as { n: number };
    return `${name}=${n}`;
  });
  const { c } = db.prepare("SELECT total_changes() AS c").get() as { c: number };
  return `${counts.join(",")};total_changes=${c}`;
}

describe("POST /api/csp-report", () => {
  before(async () => {
    runMigrations(getDb());
    const { createApp } = await import("../../app");
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDb();
  });

  beforeEach(() => {
    logged = [];
    mock.method(console, "log", (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    mock.restoreAll();
  });

  it("answers 204 to application/csp-report and logs one stripped line", async () => {
    const ip = nextIp();
    const res = await post(JSON.stringify(LEGACY), "application/csp-report", ip);
    assert.equal(res.status, 204);
    assert.equal(await res.text(), "");

    const lines = logged.filter((l) => l.startsWith("[csp-report]"));
    assert.equal(lines.length, 1, `expected one line, got ${JSON.stringify(logged)}`);
    const entry = JSON.parse(lines[0]!.slice("[csp-report] ".length));
    assert.deepEqual(entry, {
      directive: "script-src-elem",
      blocked: "https://evil.example/x.js",
      doc: "/play",
      n: 1,
    });

    const all = logged.join("\n");
    for (const leak of [ip, "SECRET", "ORIGINAL-POLICY-MARKER", "SCRIPT-SAMPLE-MARKER", "referrer.example", "chunk.js"]) {
      assert.ok(!all.includes(leak), `log line must not contain ${leak}: ${all}`);
    }
  });

  it("answers 204 to application/reports+json and logs one line for the batch", async () => {
    // Over 1kb on purpose: app.ts's global express.json({ limit: "1kb" }) must
    // not be the parser that reads this media type.
    const body = JSON.stringify([...REPORTING_API, { type: "csp-violation", body: { pad: "p".repeat(1500) } }]);
    assert.ok(body.length > 1024);
    const ip = nextIp();
    const res = await post(body, "application/reports+json", ip);
    assert.equal(res.status, 204);

    const lines = logged.filter((l) => l.startsWith("[csp-report]"));
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]!.slice("[csp-report] ".length));
    assert.deepEqual(entry, {
      directive: "connect-src",
      blocked: "wss://relay.example/socket",
      doc: "/shop",
      n: 3,
    });
    const all = logged.join("\n");
    for (const leak of [ip, "SECRET", "UA-MARKER", "ORIGINAL-POLICY-MARKER", "SCRIPT-SAMPLE-MARKER", "ppp"]) {
      assert.ok(!all.includes(leak), `log line must not contain ${leak}: ${all}`);
    }
  });

  it("cannot be made to forge a second log line", async () => {
    const report = { "csp-report": { "violated-directive": "img-src\n[admin-auth] POST /api/admin forged", "document-uri": "/a\nb" } };
    assert.equal((await post(JSON.stringify(report), "application/csp-report")).status, 204);
    assert.equal(logged.length, 1);
    assert.equal(logged[0]!.split("\n").length, 1, logged[0]);
  });

  it("answers 413 above 8kb and logs nothing", async () => {
    const big = JSON.stringify({
      "csp-report": { "violated-directive": "img-src", "blocked-uri": "x".repeat(MAX_REPORT_BYTES) },
    });
    assert.ok(big.length > MAX_REPORT_BYTES);
    const res = await post(big, "application/csp-report");
    assert.equal(res.status, 413);
    assert.equal(logged.length, 0, `nothing should be logged: ${JSON.stringify(logged)}`);
  });

  it("refuses a gzip-encoded body rather than inflating it past the cap", async () => {
    const res = await fetch(`${baseUrl}/api/csp-report`, {
      method: "POST",
      headers: { "Content-Type": "application/csp-report", "Content-Encoding": "gzip", "X-Forwarded-For": nextIp() },
      body: "not really gzip",
    });
    assert.equal(res.status, 415);
    assert.equal(logged.length, 0);
  });

  it("answers 400 to malformed JSON without echoing it, and does not reach the error handler's log", async () => {
    const errors: string[] = [];
    mock.method(console, "error", (...args: unknown[]) => {
      errors.push(args.map(String).join(" "));
    });
    // body-parser's own message for this input is `Unexpected token 'E',
    // "ECHOMARK" is not valid JSON`: it quotes the body. Passed to next(err),
    // app.ts's errorHandler would log it and send it back.
    const res = await post("ECHOMARK", "application/csp-report");
    assert.equal(res.status, 400);
    assert.ok(!(await res.text()).includes("ECHOMARK"));
    assert.equal(logged.length, 0);
    assert.ok(!errors.join("\n").includes("ECHOMARK"), errors.join("\n"));
  });

  it("answers 400 to a well-formed body that is not a report", async () => {
    assert.equal((await post(JSON.stringify({ hello: 1 }), "application/csp-report")).status, 400);
    assert.equal((await post(JSON.stringify([{ type: "deprecation", body: {} }]), "application/reports+json")).status, 400);
    assert.equal(logged.length, 0);
  });

  it("answers 415 to other media types, application/json included, and logs nothing", async () => {
    assert.equal((await post(JSON.stringify(LEGACY), "application/json")).status, 415);
    assert.equal((await post(JSON.stringify(LEGACY), "text/plain")).status, 415);
    assert.equal(logged.length, 0);
  });

  it("is not served on GET", async () => {
    const res = await fetch(`${baseUrl}/api/csp-report`, { headers: { "X-Forwarded-For": nextIp() } });
    assert.equal(res.status, 404);
    assert.equal(logged.length, 0);
  });

  it("writes nothing to the database", async () => {
    const beforeFp = dbFingerprint();
    assert.equal((await post(JSON.stringify(LEGACY), "application/csp-report")).status, 204);
    assert.equal((await post(JSON.stringify(REPORTING_API), "application/reports+json")).status, 204);
    assert.equal((await post("{", "application/csp-report")).status, 400);
    assert.equal(dbFingerprint(), beforeFp);

    // And the module has no way to: it imports nothing from db/.
    const source = readFileSync(path.join(__dirname, "..", "csp-report.ts"), "utf8");
    assert.ok(!/from\s+["'][^"']*\/db\//.test(source), "csp-report.ts must not import the DB");
  });

  it("is under the global per-IP POST limiter", async () => {
    const ip = nextIp();
    let last = 0;
    for (let i = 0; i < 61; i++) {
      last = (await post(JSON.stringify(LEGACY), "application/csp-report", ip)).status;
    }
    assert.equal(last, 429);
  });
});

describe("csp-report field sanitising", () => {
  it("keeps origin + path for any scheme with a host and drops the query", () => {
    assert.equal(blockedUri("https://a.example/p?q=1#h"), "https://a.example/p");
    assert.equal(blockedUri("wss://a.radixdlt.com/x?token=t"), "wss://a.radixdlt.com/x");
    assert.equal(blockedUri("chrome-extension://abcdef/x.js?y=1"), "chrome-extension://abcdef/x.js");
  });

  it("logs a host-less URL as its scheme only, and CSP keywords as given", () => {
    assert.equal(blockedUri("data:text/html,<script>alert(1)</script>"), "data");
    assert.equal(blockedUri("javascript:alert(document.cookie)"), "javascript");
    for (const t of ["inline", "eval", "data", "blob", "self"]) assert.equal(blockedUri(t), t);
  });

  it("cuts the query from an unparseable value and caps its length", () => {
    assert.equal(blockedUri("not a url?secret=1"), "not a url");
    const long = blockedUri("x".repeat(5000))!;
    assert.ok(long.length <= 201, `got ${long.length}`);
  });

  it("logs only the document's path", () => {
    assert.equal(documentPath("https://memegrid.radixguild.com/play?s=1#f"), "/play");
    assert.equal(documentPath("/relative?s=1"), "/relative");
    assert.equal(documentPath(""), null);
    assert.equal(documentPath(42), null);
  });

});
