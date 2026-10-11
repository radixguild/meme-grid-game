// Env must be set before any import: the DB singleton opens on first getDb().
process.env.DB_PATH = ":memory:";
// validateAddress now checks the bech32m checksum AND the network, so the
// mainnet fixtures below are only accepted when the server thinks it is on
// mainnet. Declare it explicitly rather than inheriting the stokenet default.
process.env.RADIX_NETWORK = "mainnet";

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { getDb, closeDb } from "../../db/connection";
import { runMigrations } from "../../db/migrations/runner";
import { createApp } from "../../app";
import { issueSession } from "../../auth/session";
import { MAINNET_ACCOUNTS } from "../../__tests__/fixtures/addresses";

const ADDR_A = MAINNET_ACCOUNTS[0];
const ADDR_B = "account_rdx12945s526fxx2c6faj3pykzl6jgl90mhwtnnsgp773r3rp37cstq4lx";

let baseUrl = "";
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;

// routes/daily.ts now requires proof of ownership on-chain addresses
// (`required-for-wallets`, 2026-09-10 — see daily-authz.test.ts for the gate
// itself), so every check-in below authenticates as the address's own owner.
function ownerHeaders(address: string): Record<string, string> {
  return { Authorization: `Bearer ${issueSession({ radix_address: address }).token}` };
}

async function checkIn(address: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}/api/daily/${address}`, { headers });
  return { status: res.status, body: (await res.json()) as any };
}

const balance = (addr: string): number =>
  (getDb().prepare("SELECT meme_balance AS b FROM players WHERE radix_address = ?").get(addr) as
    | { b: number }
    | undefined)?.b ?? 0;

describe("GET /api/daily/:address — check-in credits every player, not just the first", () => {
  before(async () => {
    runMigrations(getDb());
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    const db = getDb();
    db.exec("DELETE FROM roll_credits; DELETE FROM players; DELETE FROM auth_sessions;");
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDb();
  });

  // The daily check-in no longer credits ROLLS at any streak tier — see
  // game/streaks.ts. That removed the only production caller of creditRolls(), so
  // the per-player ledger uniqueness property this file used to exercise through the
  // route is now covered directly, and better, in
  // db/queries/__tests__/roll-credits.test.ts ("scopes uniqueness per player").
  //
  // What is worth testing HERE is that the check-in still works as a streak tick and
  // that it puts nothing in the ledger.
  it("advances the streak without crediting any ROLLS", async () => {
    const a = await checkIn(ADDR_A, ownerHeaders(ADDR_A));
    assert.equal(a.status, 200);
    assert.equal(a.body.ok, true);
    assert.equal(a.body.already_checked_in, false);
    assert.equal(a.body.streak, 1);
    assert.equal(a.body.reward.freeMeme, 0, "a check-in is not work and must pay no ROLLS");
    assert.equal(a.body.reward.freeRolls, 0);
    assert.equal(balance(ADDR_A), 0, "no balance may move on a check-in");

    const rows = getDb()
      .prepare("SELECT count(*) AS n FROM roll_credits WHERE source = 'daily'")
      .get() as { n: number };
    assert.equal(rows.n, 0, "no daily ledger rows — the faucet is closed");
  });

  it("credits nothing for a second player either", async () => {
    await checkIn(ADDR_A, ownerHeaders(ADDR_A));
    const b = await checkIn(ADDR_B, ownerHeaders(ADDR_B));
    assert.equal(b.body.ok, true);
    assert.equal(b.body.already_checked_in, false);
    assert.equal(balance(ADDR_B), 0);
  });

  it("is idempotent on a repeat check-in the same day", async () => {
    const headers = ownerHeaders(ADDR_A);
    await checkIn(ADDR_A, headers);
    const again = await checkIn(ADDR_A, headers);
    assert.equal(again.status, 200);
    assert.equal(again.body.already_checked_in, true);
    assert.equal(again.body.reward, null);
    assert.equal(balance(ADDR_A), 0);
  });
});
