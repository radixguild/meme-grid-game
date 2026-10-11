// routes/powerups.ts shipped with NO ownership check at all.
//
// `validateAddress` proves an address is well-formed and on-ledger — never that
// the caller owns it. Every other money-moving route (game.ts board/roll,
// token.ts deposit, vault.ts claim) pins `required-for-wallets` inline; PR #47
// added that gate route-by-route and powerups.ts was simply missed. So until
// this fix, anyone who read an address off the public leaderboard could POST
// /buy to spend that player's ROLLS, and /use to consume their inventory and
// mutate their live board — no session, no consent.
//
// These tests pin it shut. They must fail if either `requireAuth` call is
// removed from routes/powerups.ts.
process.env.DB_PATH = ":memory:";
process.env.RADIX_NETWORK = "mainnet";

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { createApp as CreateApp } from "../../app";
import { getDb, closeDb } from "../../db/connection";
import { runMigrations } from "../../db/migrations/runner";
import { issueSession } from "../../auth/session";
import { getPlayerPowerUps } from "../../db/queries/powerups";
import { MAINNET_ACCOUNTS } from "../../__tests__/fixtures/addresses";

const ADDR = MAINNET_ACCOUNTS[0];
const OTHER = MAINNET_ACCOUNTS[1];
const GUEST = "guest_powerupauthz";

let baseUrl = "";
let server: ReturnType<ReturnType<typeof CreateApp>["listen"]>;

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, body: (await res.json()) as any }));
}

function fundPlayer(address: string, memeBalance = 1000) {
  getDb()
    .prepare("INSERT INTO players (radix_address, meme_balance) VALUES (?, ?)")
    .run(address, memeBalance);
}

function balanceOf(address: string): number | undefined {
  return (
    getDb()
      .prepare("SELECT meme_balance AS b FROM players WHERE radix_address = ?")
      .get(address) as { b: number } | undefined
  )?.b;
}

describe("routes/powerups.ts — /buy and /use require proof of ownership", () => {
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
    getDb().exec(
      "DELETE FROM powerups; DELETE FROM boards; DELETE FROM players; DELETE FROM auth_sessions;"
    );
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.ROLA_AUTH_MODE;
    closeDb();
  });

  it("401s /buy for an on-chain address with no session, and spends nothing", async () => {
    fundPlayer(ADDR, 1000);
    const r = await post(`/api/powerups/${ADDR}/buy`, { type: "reroll" });
    assert.equal(r.status, 401);
    assert.equal(r.body.ok, false);
    // The gate short-circuits before the debit transaction runs.
    assert.equal(balanceOf(ADDR), 1000);
    assert.equal(getPlayerPowerUps(ADDR).length, 0);
  });

  it("403s /buy when the session belongs to a different address", async () => {
    fundPlayer(ADDR, 1000);
    const s = issueSession({ radix_address: OTHER });
    const r = await post(
      `/api/powerups/${ADDR}/buy`,
      { type: "reroll" },
      { authorization: `Bearer ${s.token}` }
    );
    assert.equal(r.status, 403);
    assert.equal(balanceOf(ADDR), 1000);
  });

  it("401s /buy with an invalid session token", async () => {
    fundPlayer(ADDR, 1000);
    const r = await post(
      `/api/powerups/${ADDR}/buy`,
      { type: "reroll" },
      { authorization: "Bearer " + "0".repeat(64) }
    );
    assert.equal(r.status, 401);
    assert.equal(balanceOf(ADDR), 1000);
  });

  it("allows /buy with the address's own session — the gate blocks strangers, not owners", async () => {
    fundPlayer(ADDR, 1000);
    const s = issueSession({ radix_address: ADDR });
    const r = await post(
      `/api/powerups/${ADDR}/buy`,
      { type: "reroll" },
      { authorization: `Bearer ${s.token}` }
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(balanceOf(ADDR), 995); // reroll costs 5
    assert.equal(getPlayerPowerUps(ADDR).length, 1);
  });

  it("401s /use for an on-chain address with no session, before any board lookup", async () => {
    fundPlayer(ADDR, 1000);
    const r = await post(`/api/powerups/${ADDR}/use`, { type: "reroll", row: 0, col: 0 });
    assert.equal(r.status, 401);
    assert.equal(r.body.ok, false);
  });

  it("403s /use when the session belongs to a different address", async () => {
    fundPlayer(ADDR, 1000);
    const s = issueSession({ radix_address: OTHER });
    const r = await post(
      `/api/powerups/${ADDR}/use`,
      { type: "reroll", row: 0, col: 0 },
      { authorization: `Bearer ${s.token}` }
    );
    assert.equal(r.status, 403);
  });

  it("still lets a guest id through without a session — required-for-wallets must not break guest play", async () => {
    fundPlayer(GUEST, 1000);
    const r = await post(`/api/powerups/${GUEST}/buy`, { type: "reroll" });
    // Not 401/403: a guest can never hold a ROLA session, so the gate trusts
    // the URL for non-on-chain ids exactly as "legacy" does.
    assert.equal(r.status, 200);
    assert.equal(balanceOf(GUEST), 995);
  });
  // MG-4: POWER_UPS is a plain object, so inherited keys used to pass the type
  // check. "constructor" debited `undefined` → meme_balance became NULL.
  for (const type of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
    it(`400s /buy and /use for the inherited key "${type}" and leaves the balance intact`, async () => {
      fundPlayer(ADDR, 1000);
      const s = issueSession({ radix_address: ADDR });
      const auth = { authorization: `Bearer ${s.token}` };
      const buy = await post(`/api/powerups/${ADDR}/buy`, { type }, auth);
      assert.equal(buy.status, 400);
      assert.equal(buy.body.error, "Invalid power-up type");
      assert.equal(balanceOf(ADDR), 1000);
      assert.equal(getPlayerPowerUps(ADDR).length, 0);

      const use = await post(`/api/powerups/${ADDR}/use`, { type }, auth);
      assert.equal(use.status, 400);
      assert.equal(use.body.error, "Invalid power-up type");
      assert.equal(balanceOf(ADDR), 1000);
    });
  }

  it("400s a non-string type", async () => {
    fundPlayer(GUEST, 1000);
    const r = await post(`/api/powerups/${GUEST}/buy`, { type: ["reroll"] });
    assert.equal(r.status, 400);
    assert.equal(balanceOf(GUEST), 1000);
  });
});
