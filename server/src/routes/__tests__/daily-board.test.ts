process.env.DB_PATH = ":memory:";

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { getDb, closeDb } from "../../db/connection";
import { runMigrations } from "../../db/migrations/runner";
import { createApp } from "../../app";
import { generateGrid, getDailySeed } from "../../game/grid";
// Import the price rather than repeating the literal — economy.ts exists because
// a duplicated price is what caused the 10x daily over-credit.
import { BOARD_COST } from "../../game/economy";

// GUEST_ADDRESS_REGEX (middleware/validate.ts) is `guest_[a-z0-9]{8,32}` — no
// underscores after the prefix.
const ADDR_A = "guest_dailytesta";
const ADDR_B = "guest_dailytestb";
const ADDR_C = "guest_dailytestc";

let baseUrl = "";
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;

async function createNewBoard(address: string, body: unknown = {}) {
  const res = await fetch(`${baseUrl}/api/game/${address}/board/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

// The route response goes through redactBoard(), which hides every unhit
// cell's type — exactly the privacy behavior PR #8 pinned. To actually
// compare boards for "same seed -> same board", read the raw row.
function rawGrid(address: string): ReturnType<typeof generateGrid> {
  const row = getDb()
    .prepare("SELECT grid FROM boards WHERE radix_address = ? ORDER BY id DESC LIMIT 1")
    .get(address) as { grid: string };
  return JSON.parse(row.grid);
}

function fundPlayer(address: string, memeBalance = 1000) {
  getDb()
    .prepare("INSERT INTO players (radix_address, meme_balance) VALUES (?, ?)")
    .run(address, memeBalance);
}

describe("POST /api/game/:address/board/new — daily seed threading", () => {
  before(async () => {
    runMigrations(getDb());
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    const db = getDb();
    db.exec("DELETE FROM boards; DELETE FROM players;");
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDb();
  });

  it("without `daily`, board creation is unchanged (random, redacted)", async () => {
    fundPlayer(ADDR_A);
    const r = await createNewBoard(ADDR_A);
    assert.equal(r.status, 200);
    // Redaction is untouched: every unhit cell hides its type.
    assert.ok(r.body.board.grid.flat().every((c: any) => c.type === null));
    assert.ok(r.body.message.startsWith("New board created!"), r.body.message);
  });

  it("with `daily: true`, two different players get the byte-identical grid", async () => {
    fundPlayer(ADDR_A);
    fundPlayer(ADDR_B);

    const ra = await createNewBoard(ADDR_A, { daily: true });
    const rb = await createNewBoard(ADDR_B, { daily: true });
    assert.equal(ra.status, 200);
    assert.equal(rb.status, 200);
    assert.ok(ra.body.message.startsWith("Daily Challenge board created!"), ra.body.message);

    assert.deepEqual(rawGrid(ADDR_A), rawGrid(ADDR_B), "same-day daily boards must be identical");
  });

  it("matches generateGrid(getDailySeed()) exactly — the seed is actually load-bearing", async () => {
    fundPlayer(ADDR_C);
    await createNewBoard(ADDR_C, { daily: true });
    const expected = generateGrid(getDailySeed());
    assert.deepEqual(rawGrid(ADDR_C), expected);
  });

  it("a daily board still hides unhit cell types in the API response (no full-board leak)", async () => {
    fundPlayer(ADDR_A);
    const r = await createNewBoard(ADDR_A, { daily: true });
    assert.ok(r.body.board.grid.flat().every((c: any) => c.type === null && c.completed === false));
  });

  it("`daily: false` and a missing body both fall back to a random board", async () => {
    fundPlayer(ADDR_A);
    fundPlayer(ADDR_B);
    const rFalse = await createNewBoard(ADDR_A, { daily: false });
    const rOmitted = await createNewBoard(ADDR_B);
    assert.equal(rFalse.status, 200);
    assert.equal(rOmitted.status, 200);
    // Extremely unlikely to collide with the actual daily grid or each other
    // if both are still randomly generated.
    assert.notDeepEqual(rawGrid(ADDR_A), generateGrid(getDailySeed()));
  });

  it("GET /api/daily/challenge/today no longer returns a numeric seed", async () => {
    const res = await fetch(`${baseUrl}/api/daily/challenge/today`);
    const body = (await res.json()) as any;
    assert.equal(body.ok, true);
    assert.equal("seed" in body, false, "the real generation seed must never be published");
    assert.ok(typeof body.date === "string");
  });
});

describe("POST /api/game/:address/board/new — once-per-day-per-account guard (operator ruling 2026-08-13)", () => {
  before(async () => {
    runMigrations(getDb());
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    const db = getDb();
    db.exec("DELETE FROM boards; DELETE FROM players;");
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDb();
  });

  it("same account, second `daily: true` the same UTC day returns the SAME board, no duplicate row", async () => {
    fundPlayer(ADDR_A);

    const first = await createNewBoard(ADDR_A, { daily: true });
    assert.equal(first.status, 200);
    assert.ok(first.body.message.startsWith("Daily Challenge board created!"), first.body.message);
    const balanceAfterFirst = first.body.player.meme_balance;

    const second = await createNewBoard(ADDR_A, { daily: true });
    assert.equal(second.status, 200);
    assert.equal(second.body.board.id, first.body.board.id, "must return the same board row");
    assert.equal(
      second.body.player.meme_balance,
      balanceAfterFirst,
      "must not spend BOARD_COST a second time"
    );
    assert.notEqual(
      second.body.message,
      first.body.message,
      "the idempotent return should say so, not repeat the creation message"
    );

    const rowCount = (
      getDb()
        .prepare("SELECT COUNT(*) AS n FROM boards WHERE radix_address = ? AND is_daily = 1")
        .get(ADDR_A) as { n: number }
    ).n;
    assert.equal(rowCount, 1, "exactly one daily-board row must exist for this account today");
  });

  it("repeated `daily: true` attempts (3x) still only ever produce one row and one charge", async () => {
    fundPlayer(ADDR_A);
    const results = [];
    for (let i = 0; i < 3; i++) results.push(await createNewBoard(ADDR_A, { daily: true }));
    for (const r of results) assert.equal(r.status, 200);

    const ids = new Set(results.map((r) => r.body.board.id));
    assert.equal(ids.size, 1, "every attempt must resolve to the same board id");

    const player = getDb().prepare("SELECT meme_balance FROM players WHERE radix_address = ?").get(ADDR_A) as {
      meme_balance: number;
    };
    assert.equal(player.meme_balance, 1000 - BOARD_COST, "BOARD_COST charged exactly once across all 3 attempts");
  });

  it("a different UTC day allows a new daily board (the guard is scoped per day, not lifetime)", async () => {
    fundPlayer(ADDR_A);
    const db = getDb();
    // Simulate a stale daily board from a prior UTC day, already completed —
    // 'completed' (not 'active') so this test stays isolated from the separate
    // "one active board at a time" rule (game/state-machine.ts::validateNewBoard),
    // which is pre-existing behavior unrelated to the day-guard under test.
    db.prepare(
      "INSERT INTO boards (radix_address, grid, is_daily, daily_date, status) VALUES (?, ?, 1, ?, 'completed')"
    ).run(ADDR_A, JSON.stringify(generateGrid(1)), "2000-01-01");

    const r = await createNewBoard(ADDR_A, { daily: true });
    assert.equal(r.status, 200);
    assert.ok(r.body.message.startsWith("Daily Challenge board created!"), r.body.message);

    const rows = db
      .prepare("SELECT daily_date FROM boards WHERE radix_address = ? AND is_daily = 1 ORDER BY id")
      .all(ADDR_A) as { daily_date: string }[];
    assert.equal(rows.length, 2, "yesterday's stale row plus today's brand-new row");
    assert.equal(rows[0].daily_date, "2000-01-01");
    assert.notEqual(rows[1].daily_date, "2000-01-01");
  });

  it("a different account may create its own daily board the same day — the guard is per-account, not global", async () => {
    fundPlayer(ADDR_A);
    fundPlayer(ADDR_B);

    const ra = await createNewBoard(ADDR_A, { daily: true });
    const rb = await createNewBoard(ADDR_B, { daily: true });
    assert.equal(ra.status, 200);
    assert.equal(rb.status, 200);
    assert.notEqual(ra.body.board.id, rb.body.board.id, "each account gets its own row");
    assert.deepEqual(rawGrid(ADDR_A), rawGrid(ADDR_B), "still the same shared layout for the day");

    // A second attempt for A must not disturb B's board or vice versa.
    const raAgain = await createNewBoard(ADDR_A, { daily: true });
    assert.equal(raAgain.body.board.id, ra.body.board.id);
  });
});
