// POST /api/game/:address/board/abandon must require proof of ownership (MG-2).
//
// The route sat on a bare requireAuth(), so it took the env default — `legacy`
// in production — which trusts the URL address. Anyone reading an address off
// the public leaderboard could abandon that player's active board: no refund,
// and a daily board cannot be restarted that UTC day. These tests fail if the
// route's `required-for-wallets` pin is removed.
process.env.DB_PATH = ":memory:";
process.env.RADIX_NETWORK = "mainnet";

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { createApp as CreateApp } from "../../app";
import { getDb, closeDb } from "../../db/connection";
import { runMigrations } from "../../db/migrations/runner";
import { issueSession } from "../../auth/session";
import { createBoard, getActiveBoard } from "../../db/queries/boards";
import { generateGrid } from "../../game/grid";
import { MAINNET_ACCOUNTS } from "../../__tests__/fixtures/addresses";

const ADDR = MAINNET_ACCOUNTS[0];
const OTHER = MAINNET_ACCOUNTS[1];
const GUEST = "guest_abandonauthz";

let baseUrl = "";
let server: ReturnType<ReturnType<typeof CreateApp>["listen"]>;

function abandon(address: string, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/game/${address}/board/abandon`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: "{}",
  }).then(async (res) => ({ status: res.status, body: (await res.json()) as any }));
}

function seedActiveBoard(address: string) {
  getDb().prepare("INSERT INTO players (radix_address, meme_balance) VALUES (?, 100)").run(address);
  createBoard(address, generateGrid());
}

describe("routes/game.ts — board/abandon requires proof of ownership", () => {
  before(async () => {
    runMigrations(getDb());
    // The route must pin its own mode: prove the permissive env default is not
    // what makes these pass.
    process.env.ROLA_AUTH_MODE = "legacy";
    const { createApp } = await import("../../app");
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    getDb().exec("DELETE FROM boards; DELETE FROM players; DELETE FROM auth_sessions;");
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.ROLA_AUTH_MODE;
    closeDb();
  });

  it("401s an on-chain address with no session, and the board stays active", async () => {
    seedActiveBoard(ADDR);
    const r = await abandon(ADDR);
    assert.equal(r.status, 401);
    assert.equal(r.body.ok, false);
    assert.equal(getActiveBoard(ADDR)?.status, "active");
  });

  it("403s when the session belongs to a different address", async () => {
    seedActiveBoard(ADDR);
    const s = issueSession({ radix_address: OTHER });
    const r = await abandon(ADDR, { authorization: `Bearer ${s.token}` });
    assert.equal(r.status, 403);
    assert.equal(getActiveBoard(ADDR)?.status, "active");
  });

  it("401s an invalid session token", async () => {
    seedActiveBoard(ADDR);
    const r = await abandon(ADDR, { authorization: "Bearer " + "0".repeat(64) });
    assert.equal(r.status, 401);
    assert.equal(getActiveBoard(ADDR)?.status, "active");
  });

  it("lets the owner abandon with their own session", async () => {
    seedActiveBoard(ADDR);
    const s = issueSession({ radix_address: ADDR });
    const r = await abandon(ADDR, { authorization: `Bearer ${s.token}` });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(getActiveBoard(ADDR), null);
  });

  it("still lets a guest id abandon without a session", async () => {
    seedActiveBoard(GUEST);
    const r = await abandon(GUEST);
    assert.equal(r.status, 200);
    assert.equal(getActiveBoard(GUEST), null);
  });
});
