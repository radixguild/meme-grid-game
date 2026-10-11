// Env must be set before any import: routes/token.ts snapshots VAULT_COMPONENT /
// MEME_RESOURCE at module load, and the DB singleton opens on first getDb().
process.env.DB_PATH = ":memory:";
// validateAddress now checks the bech32m checksum AND the network, so the
// mainnet fixtures below are only accepted when the server thinks it is on
// mainnet. Declare it explicitly rather than inheriting the stokenet default.
process.env.RADIX_NETWORK = "mainnet";
process.env.ADMIN_TOKEN = "test-admin-token-32chars-exactly!";
delete process.env.ADMIN_TOKEN_PREVIOUS;
delete process.env.ADMIN_TOKEN_EXPIRES_AT;
// Phase-1 shape: no vault env, so Mode 1 (on-chain verify) is unavailable and
// the direct-credit branch is the only path to a balance credit.
delete process.env.VAULT_COMPONENT;
delete process.env.MEME_RESOURCE;

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { getDb, closeDb } from "../../db/connection";
import { runMigrations } from "../../db/migrations/runner";
import { createApp } from "../../app";
import { MAINNET_ACCOUNTS } from "../../__tests__/fixtures/addresses";
import { issueSession } from "../../auth/session";

const ADDR = MAINNET_ACCOUNTS[0];
const ADMIN = "test-admin-token-32chars-exactly!";
// A live ROLA session token for `address` — as of 2026-09-08, Mode 2 (below)
// requires one for a real `account_…` address, same as Mode 1
// (docs/PROJECT-STATE.md item 3/14 continuation).
const sessionFor = (address: string): string => issueSession({ radix_address: address }).token;

let baseUrl = "";
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;

async function deposit(body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}/api/token/${ADDR}/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const balance = (): number =>
  (getDb().prepare("SELECT meme_balance AS b FROM players WHERE radix_address = ?").get(ADDR) as
    | { b: number }
    | undefined)?.b ?? 0;

const ledgerRows = (): any[] =>
  getDb().prepare("SELECT * FROM roll_credits WHERE radix_address = ?").all(ADDR);

describe("POST /api/token/:address/deposit — direct credit is admin-gated", () => {
  before(async () => {
    runMigrations(getDb());
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    const db = getDb();
    db.exec("DELETE FROM roll_credits; DELETE FROM deposits; DELETE FROM players;");
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDb();
  });

  // The 2026-08-10 readiness-review exploit: an anonymous caller (legacy auth
  // trusts the URL address) crediting 100,000 MEME per request from nothing.
  it("401s an anonymous direct credit and credits nothing", async () => {
    const r = await deposit({ amount: "100000" });
    assert.equal(r.status, 401);
    assert.equal(r.body.ok, false);
    assert.equal(balance(), 0);
    assert.equal(ledgerRows().length, 0);
  });

  it("401s a direct credit with a wrong admin token and credits nothing", async () => {
    const r = await deposit(
      { amount: "1000" },
      { "x-admin-token": "wrong-token-value-xxxxxxxxxxxxxxx" }
    );
    assert.equal(r.status, 401);
    assert.equal(balance(), 0);
    assert.equal(ledgerRows().length, 0);
  });

  it("credits a direct deposit when both the admin token and a live wallet session are valid", async () => {
    const token = sessionFor(ADDR);
    const r = await deposit(
      { amount: "1000" },
      { "x-admin-token": ADMIN, authorization: `Bearer ${token}` }
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.method, "direct");
    assert.equal(r.body.credited, 1000);
    assert.equal(balance(), 1000);

    // Unverified credits must land as 'promo', never 'purchase' — the source
    // breakdown must not report them as revenue.
    const rows = ledgerRows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, "promo");
    assert.equal(rows[0].amount, 1000);
  });

  it("rejects out-of-range or non-integer amounts even with a valid token and session", async () => {
    const token = sessionFor(ADDR);
    for (const amount of ["200000", "abc", "-5", "1.5"]) {
      const r = await deposit(
        { amount },
        { "x-admin-token": ADMIN, authorization: `Bearer ${token}` }
      );
      assert.equal(r.status, 400, `amount=${amount} should 400`);
    }
    assert.equal(balance(), 0);
    assert.equal(ledgerRows().length, 0);
  });

  it("400s when neither tx_hash nor amount is provided", async () => {
    const r = await deposit({});
    assert.equal(r.status, 400);
    assert.equal(balance(), 0);
  });

  it("cannot be credited via tx_hash when phase-2 env is unset", async () => {
    // Without VAULT_COMPONENT/MEME_RESOURCE a tx_hash alone must fall through
    // to 400 — never into a credit path.
    const r = await deposit({ tx_hash: "txid_rdx1qtestdeadbeef" });
    assert.equal(r.status, 400);
    assert.equal(balance(), 0);
    assert.equal(ledgerRows().length, 0);
  });

  it("409s a replayed tx_hash on admin direct credit (no double-credit)", async () => {
    const headers = { "x-admin-token": ADMIN, authorization: `Bearer ${sessionFor(ADDR)}` };
    const first = await deposit({ amount: "500", tx_hash: "txid_rdx1qreplaytest" }, headers);
    assert.equal(first.status, 200);
    const second = await deposit({ amount: "500", tx_hash: "txid_rdx1qreplaytest" }, headers);
    assert.equal(second.status, 409);
    assert.equal(balance(), 500);
    assert.equal(ledgerRows().length, 1);
  });
  // MG-8: getOrCreatePlayer used to run before any auth or input check, so a
  // refused request still inserted a players row (inflating /api/health's count).
  const playerRow = (): unknown =>
    getDb().prepare("SELECT 1 FROM players WHERE radix_address = ?").get(ADDR);

  it("a refused deposit creates no players row", async () => {
    assert.equal((await deposit({})).status, 400);
    assert.equal((await deposit({ tx_hash: "txid_rdx1qnorow" })).status, 400);
    assert.equal((await deposit({ amount: "100" })).status, 401);
    assert.equal(
      (await deposit({ amount: "100" }, { authorization: `Bearer ${sessionFor(ADDR)}` })).status,
      401,
      "a wallet session without the admin token is still refused"
    );
    assert.equal(
      (await deposit({ amount: "0" }, { "x-admin-token": ADMIN, authorization: `Bearer ${sessionFor(ADDR)}` })).status,
      400
    );
    assert.equal(playerRow(), undefined);
  });

  it("an accepted direct credit still creates the row it credits", async () => {
    const r = await deposit({ amount: "25" }, { "x-admin-token": ADMIN, authorization: `Bearer ${sessionFor(ADDR)}` });
    assert.equal(r.status, 200);
    assert.ok(playerRow());
    assert.equal(balance(), 25);
  });

  it("GET balance for an unseen address reads zeros and creates no row", async () => {
    const res = await fetch(`${baseUrl}/api/token/${ADDR}/balance`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.deepEqual(
      { b: body.meme_balance, d: body.total_deposited, s: body.total_spent },
      { b: 0, d: 0, s: 0 }
    );
    assert.equal(playerRow(), undefined);
  });
});
