// routes/daily.ts had no ownership check on its address-scoped check-in route.
//
// `validateAddress` proves an address is well-formed and on-ledger — never that
// the caller owns it. PR #47 added `required-for-wallets` route-by-route to the
// money-moving routes; #52 (powerups.ts) and #53 (faucet.ts) closed two routes
// that sweep had missed. daily.ts was the last address-scoped route left open:
// its check-in advances the streak and credits an XP bonus and (at some tiers)
// a power-up to whatever address is named in the URL.
//
// #53 deliberately left this route alone: the ROLLS side of the reward is dead
// code (every streak tier pays zero ROLLS — game/streaks.ts — so this was never
// a funds-drain route), and gating it broke 3 tests that assumed anonymous
// check-in (see daily-checkin.test.ts). The operator ruled 2026-09-10 to gate it
// anyway, as best practice and for parity with the rest of the address-scoped
// surface — the streak, the XP bonus and the power-up grant are still real
// per-account state that a stranger should not get to direct.
//
// These tests pin it shut. They must fail if the `requireAuth` call is removed
// from routes/daily.ts.
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

function get(path: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, { headers }).then(async (res) => ({
    status: res.status,
    body: (await res.json()) as any,
  }));
}

function post(path: string) {
  return fetch(`${baseUrl}${path}`, { method: "POST" }).then(async (res) => ({
    status: res.status,
    body: (await res.json()) as any,
  }));
}

const streakOf = (address: string): number | undefined =>
  (
    getDb()
      .prepare("SELECT streak_current AS s FROM players WHERE radix_address = ?")
      .get(address) as { s: number } | undefined
  )?.s;

describe("routes/daily.ts — check-in requires proof of ownership", () => {
  before(async () => {
    runMigrations(getDb());
    // The route pins required-for-wallets inline, so the env default must not
    // be what makes these pass — set it to the permissive mode to prove that.
    process.env.ROLA_AUTH_MODE = "legacy";
    const { createApp } = await import("../../app");
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    getDb().exec("DELETE FROM roll_credits; DELETE FROM players; DELETE FROM auth_sessions;");
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.ROLA_AUTH_MODE;
    closeDb();
  });

  it("rejects an unauthenticated check-in for an on-chain address, and touches no player row", async () => {
    const res = await get(`/api/daily/${ADDR}`);
    assert.equal(res.status, 401);
    assert.equal(streakOf(ADDR), undefined, "an unauthenticated call must not create or advance a player row");
  });

  it("401s with an invalid or expired session token, same as no session at all", async () => {
    const res = await get(`/api/daily/${ADDR}`, { Authorization: "Bearer " + "0".repeat(64) });
    assert.equal(res.status, 401);
    assert.equal(streakOf(ADDR), undefined);
  });

  it("rejects a check-in made with someone else's session (cross-address)", async () => {
    const s = issueSession({ radix_address: OTHER });
    const res = await get(`/api/daily/${ADDR}`, { Authorization: `Bearer ${s.token}` });
    assert.equal(res.status, 403);
    assert.equal(streakOf(ADDR), undefined, "a foreign session must not advance ADDR's streak");
  });

  it("allows the owner's own session to check in", async () => {
    const s = issueSession({ radix_address: ADDR });
    const res = await get(`/api/daily/${ADDR}`, { Authorization: `Bearer ${s.token}` });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.streak, 1);
    assert.equal(streakOf(ADDR), 1);
  });

  // Guest play must be untouched: `required-for-wallets` only demands a session
  // when the URL address is a real on-chain `account_…`, and a guest can never
  // hold a ROLA session. This is the regression that would bite real users if
  // the gate were widened to plain `required`.
  //
  // The id must be server-issued: a self-minted `guest_…` literal is rejected 401
  // by validateAddress's HMAC check (migration 015), which would make this test
  // pass for entirely the wrong reason.
  it("leaves server-issued guest ids checking in with no session at all", async () => {
    const issued = await post("/api/guest/new");
    assert.equal(issued.status, 200, "guest issuance must succeed");
    const guest = issued.body.guest_id;
    assert.ok(guest, `expected an issued guest id, got ${JSON.stringify(issued.body)}`);

    const res = await get(`/api/daily/${guest}`);
    assert.equal(res.status, 200, "a guest must not need a ROLA session");
    assert.equal(res.body.ok, true);
    assert.equal(streakOf(guest), 1);
  });
});
