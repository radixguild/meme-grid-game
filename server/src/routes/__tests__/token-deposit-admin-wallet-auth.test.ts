// Exercises the required-for-wallets gate added to routes/token.ts's Mode 2
// (admin direct-credit) branch — PROJECT-STATE.md item 3/14 continuation,
// 2026-09-08 (bigdev ruling: "Mode-2 → wallet proofs like Mode-1, not
// adminAuth [alone]"). Its own file for the same reason
// token-deposit-onchain-auth.test.ts (Mode 1's equivalent) is: routes/token.ts
// snapshots VAULT_COMPONENT/MEME_RESOURCE at import time, and
// token-deposit.test.ts already owns the Phase-1, adminAuth-only coverage for
// this branch (updated in this PR to also carry a session where the new gate
// now requires one). Mode 2 itself never depends on VAULT_COMPONENT, but Phase-1
// (both unset) keeps this file from accidentally exercising Mode 1 too.
process.env.DB_PATH = ":memory:";
process.env.RADIX_NETWORK = "mainnet";
process.env.ADMIN_TOKEN = "test-admin-token-32chars-exactly!";
delete process.env.ADMIN_TOKEN_PREVIOUS;
delete process.env.ADMIN_TOKEN_EXPIRES_AT;
delete process.env.VAULT_COMPONENT;
delete process.env.MEME_RESOURCE;

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
const ADMIN = "test-admin-token-32chars-exactly!";

let baseUrl = "";
let server: ReturnType<ReturnType<typeof CreateApp>["listen"]>;

async function deposit(address: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}/api/token/${address}/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

const balanceOf = (address: string): number =>
  (getDb().prepare("SELECT meme_balance AS b FROM players WHERE radix_address = ?").get(address) as
    | { b: number }
    | undefined)?.b ?? 0;

describe("POST /api/token/:address/deposit — Mode 2 (admin direct credit) also requires a wallet session for real addresses (item 3/14 continuation)", () => {
  before(async () => {
    runMigrations(getDb());
    // Dynamic, not static — see token-deposit-onchain-auth.test.ts for why: a
    // hoisted static import would read VAULT_COMPONENT/MEME_RESOURCE before
    // the `delete process.env...` lines above ever ran.
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
    closeDb();
  });

  it("401s a direct credit for a real account address with a valid admin token but no session", async () => {
    const r = await deposit(ADDR, { amount: "1000" }, { "x-admin-token": ADMIN });
    assert.equal(r.status, 401);
    assert.equal(r.body.ok, false);
    assert.equal(balanceOf(ADDR), 0);
  });

  it("401s a direct credit for a real account address with a valid admin token but an invalid/expired session token", async () => {
    const r = await deposit(
      ADDR,
      { amount: "1000" },
      { "x-admin-token": ADMIN, authorization: "Bearer " + "0".repeat(64) }
    );
    assert.equal(r.status, 401);
    assert.equal(balanceOf(ADDR), 0);
  });

  it("403s a direct credit whose session address does not match the URL address", async () => {
    const s = issueSession({ radix_address: OTHER });
    const r = await deposit(
      ADDR,
      { amount: "1000" },
      { "x-admin-token": ADMIN, authorization: `Bearer ${s.token}` }
    );
    assert.equal(r.status, 403);
    assert.equal(balanceOf(ADDR), 0);
  });

  it("credits when both the admin token and a live session for the target address are valid", async () => {
    const s = issueSession({ radix_address: ADDR });
    const r = await deposit(
      ADDR,
      { amount: "1000" },
      { "x-admin-token": ADMIN, authorization: `Bearer ${s.token}` }
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.method, "direct");
    assert.equal(r.body.credited, 1000);
    assert.equal(balanceOf(ADDR), 1000);
  });

  it("a missing admin token still 401s even with a valid session for the address (adminAuth is not bypassed by a wallet proof)", async () => {
    const s = issueSession({ radix_address: ADDR });
    const r = await deposit(ADDR, { amount: "1000" }, { authorization: `Bearer ${s.token}` });
    assert.equal(r.status, 401);
    assert.equal(balanceOf(ADDR), 0);
  });

  // The legacy (pre-this-PR) path for a guest id must keep working exactly as
  // before: required-for-wallets never gates a non-on-chain address, so admin
  // can still direct-credit a guest with the operator token alone — no
  // session, because a guest can never hold one.
  it("guest ids are unaffected — admin can still direct-credit a guest with no session", async () => {
    const newGuestRes = await fetch(`${baseUrl}/api/guest/new`, { method: "POST" });
    assert.equal(newGuestRes.status, 200);
    const { guest_id: guestId } = (await newGuestRes.json()) as { guest_id: string };

    const r = await deposit(guestId, { amount: "1000" }, { "x-admin-token": ADMIN });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.credited, 1000);
    assert.equal(balanceOf(guestId), 1000);
  });
});
