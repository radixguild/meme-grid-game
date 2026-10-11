// `?limit=` on the public list routes is clamped to 1..max (MG-7).
//
// The routes computed `Math.min(parseInt(q) || fallback, max)`. parseInt("-1")
// is -1, which is truthy, so the cap never applied — and SQLite reads
// `LIMIT -1` as "no limit": ?limit=-1 returned every row.
process.env.DB_PATH = ":memory:";
process.env.RADIX_NETWORK = "mainnet";

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { createApp as CreateApp } from "../../app";
import { getDb, closeDb } from "../../db/connection";
import { runMigrations } from "../../db/migrations/runner";
import { parseLimit } from "../../middleware/validate";

const GUEST = "guest_listlimit";

describe("parseLimit", () => {
  it("clamps integers into [1, max] and falls back on junk", () => {
    assert.equal(parseLimit(undefined, 20, 100), 20);
    assert.equal(parseLimit("", 20, 100), 20);
    assert.equal(parseLimit("abc", 20, 100), 20);
    assert.equal(parseLimit("1.5", 20, 100), 20);
    assert.equal(parseLimit("1e3", 20, 100), 20);
    assert.equal(parseLimit("-1", 20, 100), 1);
    assert.equal(parseLimit("0", 20, 100), 1);
    assert.equal(parseLimit("7", 20, 100), 7);
    assert.equal(parseLimit("100000", 20, 100), 100);
    assert.equal(parseLimit(["-5", "50"], 20, 100), 1);
    assert.equal(parseLimit({ a: 1 }, 20, 100), 20);
  });
});

let baseUrl = "";
let server: ReturnType<ReturnType<typeof CreateApp>["listen"]>;

describe("list routes never return an unbounded page", () => {
  before(async () => {
    runMigrations(getDb());
    const { createApp } = await import("../../app");
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    getDb().exec("DELETE FROM reward_history; DELETE FROM boards; DELETE FROM players;");
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDb();
  });

  it("GET /api/leaderboard?limit=-1 returns at most the default page", async () => {
    const insert = getDb().prepare("INSERT INTO players (radix_address, xp) VALUES (?, ?)");
    for (let i = 0; i < 30; i++) insert.run(`guest_lb${i}`, i);
    for (const q of ["-1", "-1000", "0"]) {
      const res = await fetch(`${baseUrl}/api/leaderboard?limit=${q}`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as any;
      assert.ok(body.entries.length >= 1 && body.entries.length <= 20, `limit=${q} → ${body.entries.length}`);
    }
    const capped = (await (await fetch(`${baseUrl}/api/leaderboard?limit=5`)).json()) as any;
    assert.equal(capped.entries.length, 5);
  });

  it("GET /api/vault/rewards/:address?limit=-1 is capped", async () => {
    getDb().prepare("INSERT INTO players (radix_address) VALUES (?)").run(GUEST);
    const insert = getDb().prepare(
      "INSERT INTO reward_history (radix_address, token_name, amount, trigger_type) VALUES (?, 'T', 1, 'lucky_drop')"
    );
    for (let i = 0; i < 60; i++) insert.run(GUEST);
    const res = await fetch(`${baseUrl}/api/vault/rewards/${GUEST}?limit=-1`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.ok(body.rewards.length <= 50, `got ${body.rewards.length}`);
  });

  it("GET /api/game/:address/history?limit=-1 is capped", async () => {
    getDb().prepare("INSERT INTO players (radix_address) VALUES (?)").run(GUEST);
    const insert = getDb().prepare("INSERT INTO boards (radix_address, grid, status) VALUES (?, '[]', 'abandoned')");
    for (let i = 0; i < 15; i++) insert.run(GUEST);
    const res = await fetch(`${baseUrl}/api/game/${GUEST}/history?limit=-1`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as any;
    assert.ok(body.history.length <= 10, `got ${body.history.length}`);
  });
});
