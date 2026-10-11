/**
 * POST /api/csp-report — sink for the browser's own CSP violation reports.
 *
 * next.config.ts sends `Content-Security-Policy-Report-Only` with
 * `report-uri /api/csp-report`. A report-only policy blocks nothing; this route
 * is where the violations it would have blocked get counted, so the later
 * enforce PR has evidence instead of a guess. It lives here, not in a Next
 * route handler, because deploy/Caddyfile hands every /api/* path to this
 * server.
 *
 * What it does: parse the report, write ONE log line, answer 204. It stores
 * nothing (no DB import in this file, and the test checks the DB's change
 * counter), gates nothing, and never echoes the body back.
 *
 * ── Two body shapes ─────────────────────────────────────────────────────────
 * `report-uri` (the only mechanism next.config.ts uses):
 *   Content-Type: application/csp-report
 *   { "csp-report": { "document-uri", "violated-directive", "blocked-uri", ... } }
 * Reporting API (`report-to`; NOT configured — see next.config.ts for why):
 *   Content-Type: application/reports+json
 *   [ { "type": "csp-violation", "body": { "documentURL", "effectiveDirective",
 *       "blockedURL", ... } }, ... ]
 * The second shape is accepted so a later report-to needs no route change.
 * Any other Content-Type gets 415 and is not logged.
 *
 * ── Limits ──────────────────────────────────────────────────────────────────
 * The body parser is scoped to this route: 8kb, no gzip/deflate (browsers do
 * not compress reports, and refusing it means the 8kb is 8kb on the wire), and
 * only the two report media types. The global `express.json({ limit: "1kb" })`
 * in app.ts only parses `application/json`, so it never reads these bodies.
 * The global per-IP limiter (60 POST/min, middleware/rate-limit.ts) runs before
 * this route, so a flood costs at most 60 log lines a minute per IP. That
 * bucket is SHARED with gameplay POSTs: a browser firing dozens of reports a
 * minute would eat into that player's roll budget. Our own pages should send
 * none (the local sweep in next.config.ts recorded 0); extension-injected
 * content is the realistic source of noise.
 *
 * ── What is logged ──────────────────────────────────────────────────────────
 * One line per request: the directive, the blocked URI and the document PATH,
 * plus how many violations the request carried. Each value is truncated, and
 * the line is JSON so a newline in a field cannot forge a second log line.
 * The query string and fragment are cut from every URL (a query can carry a
 * token), for any scheme with a host — `wss://…?token=…` included; a URL with
 * no host (`data:…`, `javascript:…`) is logged as its scheme only. Never
 * logged: the client IP, User-Agent, cookies, referrer, `original-policy`,
 * `script-sample`, or the raw body. Parse failures answer 400/413/415 here
 * rather than reaching app.ts's error handler, which would log the parser's
 * message, and that message can quote the body.
 */

import { Router, json } from "express";
import type { Request, Response, NextFunction } from "express";

const router = Router();

export const CSP_REPORT_PATH = "/csp-report";
const REPORT_TYPES = ["application/csp-report", "application/reports+json"];

/** Body cap. A real report is a few hundred bytes. */
export const MAX_REPORT_BYTES = 8 * 1024;
/** Per-field cap in the log line. */
export const MAX_LOGGED_FIELD = 200;

const parseReport = json({
  type: REPORT_TYPES,
  limit: MAX_REPORT_BYTES,
  inflate: false,
});

/**
 * Run the parser, but answer its errors here. `next(err)` would reach the
 * global errorHandler, which logs `err.message` — for a JSON syntax error that
 * message quotes part of the body.
 */
function parseReportBody(req: Request, res: Response, next: NextFunction): void {
  parseReport(req, res, (err?: unknown) => {
    if (!err) {
      next();
      return;
    }
    const status = (err as { status?: unknown }).status;
    if (status === 413) {
      res.status(413).json({ ok: false, error: "Report too large" });
    } else if (status === 415) {
      res.status(415).json({ ok: false, error: "Unsupported report encoding" });
    } else {
      res.status(400).json({ ok: false, error: "Malformed report" });
    }
  });
}

interface Violation {
  directive: string | null;
  blocked: string | null;
  doc: string | null;
}

// Values a browser sends in blocked-uri when there is no URL behind the
// violation. They are the signal, so they pass through unchanged.
const OPAQUE_BLOCKED = new Set(["inline", "eval", "wasm-eval", "data", "blob", "filesystem", "about", "self"]);

function cap(value: string): string {
  return value.length > MAX_LOGGED_FIELD ? `${value.slice(0, MAX_LOGGED_FIELD)}…` : value;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** Cut the query string and fragment. */
function stripQuery(value: string): string {
  return value.split(/[?#]/, 1)[0]!;
}

/** The document's path only: the origin is always this site's own. */
export function documentPath(value: unknown): string | null {
  const s = str(value);
  if (s === null) return null;
  try {
    return cap(new URL(s).pathname);
  } catch {
    return cap(stripQuery(s));
  }
}

/** Origin + path for anything with a host, whatever the scheme; the literal for CSP keywords. */
export function blockedUri(value: unknown): string | null {
  const s = str(value);
  if (s === null) return null;
  if (OPAQUE_BLOCKED.has(s)) return s;
  try {
    const u = new URL(s);
    if (u.host !== "") {
      // `origin` is the string "null" for a non-special scheme with a host
      // (chrome-extension://id/…, the usual extension noise); rebuild it.
      const origin = u.origin !== "null" ? u.origin : `${u.protocol}//${u.host}`;
      return cap(`${origin}${u.pathname}`);
    }
    // No host (data:, about:blank, javascript:…): the rest of the value is
    // content, not a location, so only the scheme is logged.
    return cap(u.protocol.slice(0, -1));
  } catch {
    return cap(stripQuery(s));
  }
}

function fromLegacy(body: unknown): Violation[] {
  const r = (body as { "csp-report"?: unknown } | null)?.["csp-report"];
  if (!r || typeof r !== "object" || Array.isArray(r)) return [];
  const report = r as Record<string, unknown>;
  return [
    {
      directive: str(report["violated-directive"]) ?? str(report["effective-directive"]),
      blocked: blockedUri(report["blocked-uri"]),
      doc: documentPath(report["document-uri"]),
    },
  ];
}

function fromReportingApi(body: unknown): Violation[] {
  if (!Array.isArray(body)) return [];
  const out: Violation[] = [];
  for (const entry of body) {
    const b = (entry as { type?: unknown; body?: unknown } | null) ?? {};
    if (b.type !== "csp-violation" || !b.body || typeof b.body !== "object") continue;
    const v = b.body as Record<string, unknown>;
    out.push({
      directive: str(v.effectiveDirective),
      blocked: blockedUri(v.blockedURL),
      doc: documentPath(v.documentURL),
    });
  }
  return out;
}

router.post(CSP_REPORT_PATH, parseReportBody, (req: Request, res: Response) => {
  const type = req.is(REPORT_TYPES);
  if (!type) {
    // Includes application/json, which the global parser already read: a
    // browser never sends a CSP report with that type, so it is not one.
    res.status(415).json({ ok: false, error: "Expected application/csp-report or application/reports+json" });
    return;
  }

  const violations = type === "application/csp-report" ? fromLegacy(req.body) : fromReportingApi(req.body);
  if (violations.length === 0) {
    res.status(400).json({ ok: false, error: "Malformed report" });
    return;
  }

  const first = violations[0]!;
  console.log(
    `[csp-report] ${JSON.stringify({
      directive: first.directive === null ? null : cap(first.directive),
      blocked: first.blocked,
      doc: first.doc,
      n: violations.length,
    })}`
  );
  res.status(204).end();
});

export default router;
