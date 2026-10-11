// Exercises the required-for-wallets gate on routes/token.ts's Mode 1
// (on-chain tx_hash verification) branch specifically — PROJECT-STATE.md
// items 3/14. This is a separate module from token-deposit.test.ts on
// purpose: routes/token.ts snapshots VAULT_COMPONENT/MEME_RESOURCE at import
// time, and token-deposit.test.ts deliberately runs the Phase-1 shape (both
// unset) to exercise the admin direct-credit branch. Phase 2 needs both set
// before the first import of routes/token.ts, hence its own file + env block.
process.env.DB_PATH = ":memory:";
process.env.RADIX_NETWORK = "mainnet";
process.env.VAULT_COMPONENT =
  "component_rdx1cptestvaultxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
process.env.MEME_RESOURCE =
  "resource_rdx1ttestresourcexxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
delete process.env.ADMIN_TOKEN;
delete process.env.ADMIN_TOKEN_PREVIOUS;
delete process.env.ADMIN_TOKEN_EXPIRES_AT;

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { createApp as CreateApp } from "../../app";
import { getDb, closeDb } from "../../db/connection";
import { runMigrations } from "../../db/migrations/runner";
import { issueSession } from "../../auth/session";
import { MAINNET_ACCOUNTS } from "../../__tests__/fixtures/addresses";

const ADDR = MAINNET_ACCOUNTS[0];
const OTHER = MAINNET_ACCOUNTS[1];

let baseUrl = "";
let server: ReturnType<ReturnType<typeof CreateApp>["listen"]>;

async function deposit(body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}/api/token/${ADDR}/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe("POST /api/token/:address/deposit — Mode 1 requires a wallet session (item 3/14)", () => {
  before(async () => {
    runMigrations(getDb());
    // The route pins its own mode inline (required-for-wallets) regardless
    // of ROLA_AUTH_MODE — set the env to something else to prove that.
    process.env.ROLA_AUTH_MODE = "legacy";
    // Dynamic, not static: a static top-of-file `import { createApp } from
    // "../../app"` compiles (under this runner) to a require() that is
    // hoisted ahead of the env-var assignments at the top of this file, so
    // routes/token.ts's module-load-time
    // `const VAULT_COMPONENT = process.env.VAULT_COMPONENT || ""` would
    // snapshot an EMPTY value regardless of source order. Importing inside
    // this async hook — after the env vars are already set — is what
    // actually guarantees app.ts (and token.ts) sees them.
    const { createApp } = await import("../../app");
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    getDb().exec(
      "DELETE FROM roll_credits; DELETE FROM deposits; DELETE FROM players; DELETE FROM auth_sessions;"
    );
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.ROLA_AUTH_MODE;
    closeDb();
  });

  it("401s a Mode-1 (tx_hash) deposit with no session, before any on-chain lookup", async () => {
    const r = await deposit({ tx_hash: "txid_rdx1qsomehash" });
    assert.equal(r.status, 401);
    assert.equal(r.body.ok, false);
    // Nothing was recorded — the gate short-circuits before
    // verifyBuyMemeTransaction (and its Gateway call) ever runs.
    const { n } = getDb().prepare("SELECT COUNT(*) AS n FROM deposits").get() as { n: number };
    assert.equal(n, 0);
  });

  it("401s a Mode-1 deposit with an invalid/expired session token", async () => {
    const r = await deposit(
      { tx_hash: "txid_rdx1qsomehash" },
      { authorization: "Bearer " + "0".repeat(64) }
    );
    assert.equal(r.status, 401);
  });

  it("403s a Mode-1 deposit whose session address does not match the URL address", async () => {
    const s = issueSession({ radix_address: OTHER });
    const r = await deposit(
      { tx_hash: "txid_rdx1qsomehash" },
      { authorization: `Bearer ${s.token}` }
    );
    assert.equal(r.status, 403);
  });

  it("a request with neither tx_hash nor amount is unaffected by the gate — still 400", async () => {
    const r = await deposit({});
    assert.equal(r.status, 400);
  });
});
