// routes/faucet.ts had no ownership check on either address-scoped route.
//
// `validateAddress` proves an address is well-formed and on-ledger — never that
// the caller owns it. PR #47 added `required-for-wallets` route-by-route to the
// money-moving routes, and #52 caught powerups.ts as a miss from that sweep;
// faucet.ts was missed by both.
//
// Until this fix, anyone who read an address off the public leaderboard could
// POST /api/faucet/<address>/claim and burn that player's 7-day cooldown by
// enqueueing a claim row in their name — griefing today, and a faucet-drain
// vector the moment the Phase 2 TODO in faucet.ts lands the real XRD send,
// since nothing but the per-address cooldown limits how many addresses one
// party can claim for.
//
// These tests pin it shut. They must fail if either `requireAuth` call is
// removed from routes/faucet.ts.
process.env.DB_PATH = ":memory:";
process.env.RADIX_NETWORK = "mainnet";

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

function req(method: string, path: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, { method, headers }).then(async (res) => ({
    status: res.status,
    body: (await res.json()) as any,
  }));
}

const claimCount = (address: string): number =>
  (
    getDb()
      .prepare("SELECT COUNT(*) AS c FROM faucet_claims WHERE radix_address = ?")
      .get(address) as { c: number }
  ).c;

describe("routes/faucet.ts — /eligible and /claim require proof of ownership", () => {
  before(async () => {
    runMigrations(getDb());
    // The routes pin required-for-wallets inline, so the env default must not
    // be what makes these pass — set it to the permissive mode to prove that.
    process.env.ROLA_AUTH_MODE = "legacy";
    const { createApp } = await import("../../app");
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    getDb().exec("DELETE FROM faucet_claims; DELETE FROM players; DELETE FROM auth_sessions;");
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDb();
  });

  it("rejects an unauthenticated claim for an on-chain address, and records nothing", async () => {
    const res = await req("POST", `/api/faucet/${ADDR}/claim`);
    assert.equal(res.status, 401);
    assert.equal(claimCount(ADDR), 0, "an unauthenticated call must not enqueue a claim");
  });

  it("rejects an unauthenticated eligibility read for an on-chain address", async () => {
    const res = await req("GET", `/api/faucet/${ADDR}/eligible`);
    assert.equal(res.status, 401);
  });

  it("rejects a claim made with someone else's session (cross-address)", async () => {
    const s = issueSession({ radix_address: OTHER });
    const res = await req("POST", `/api/faucet/${ADDR}/claim`, {
      Authorization: `Bearer ${s.token}`,
    });
    assert.equal(res.status, 403);
    assert.equal(claimCount(ADDR), 0, "a foreign session must not enqueue a claim for ADDR");
  });

  it("allows the owner's own session to claim", async () => {
    const s = issueSession({ radix_address: ADDR });
    const res = await req("POST", `/api/faucet/${ADDR}/claim`, {
      Authorization: `Bearer ${s.token}`,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(claimCount(ADDR), 1);
  });

  it("still enforces the cooldown for the authenticated owner", async () => {
    const s = issueSession({ radix_address: ADDR });
    const first = await req("POST", `/api/faucet/${ADDR}/claim`, {
      Authorization: `Bearer ${s.token}`,
    });
    assert.equal(first.status, 200);
    const second = await req("POST", `/api/faucet/${ADDR}/claim`, {
      Authorization: `Bearer ${s.token}`,
    });
    assert.equal(second.status, 429, "cooldown must still apply on top of the auth gate");
    assert.equal(claimCount(ADDR), 1);
  });

  // Guest play must be untouched: `required-for-wallets` only demands a session
  // when the URL address is a real on-chain `account_…`, and a guest can never
  // hold a ROLA session. This is the regression that would bite real users if
  // the gate were widened to plain `required`.
  //
  // The id must be server-issued: a self-minted `guest_…` literal is rejected 401
  // by validateAddress's HMAC check (migration 015), which would make this test
  // pass for entirely the wrong reason.
  it("leaves server-issued guest ids working with no session at all", async () => {
    const issued = await req("POST", "/api/guest/new");
    assert.equal(issued.status, 200, "guest issuance must succeed");
    const guest = issued.body.guest_id ?? issued.body.address ?? issued.body.player?.radix_address;
    assert.ok(guest, `expected an issued guest id, got ${JSON.stringify(issued.body)}`);

    const eligible = await req("GET", `/api/faucet/${guest}/eligible`);
    assert.equal(eligible.status, 200, "a guest must not need a ROLA session");
    assert.equal(eligible.body.ok, true);

    const claim = await req("POST", `/api/faucet/${guest}/claim`);
    assert.equal(claim.status, 200);
    assert.equal(claim.body.ok, true);
    assert.equal(claimCount(guest), 1);
  });
});
