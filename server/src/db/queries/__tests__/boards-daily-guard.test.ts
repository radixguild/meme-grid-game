process.env.DB_PATH = ":memory:";

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { getDb, closeDb } from "../../connection";
import { runMigrations } from "../../migrations/runner";
import { createDailyBoardOnce, getDailyBoardForDate, getActiveBoard, updateBoard } from "../boards";
import { generateGrid } from "../../../game/grid";

// Query-layer tests for the once-per-day-per-account guard (operator ruling
// 2026-08-13, migration 014_daily_board_guard.sql). These exercise
// createDailyBoardOnce/getDailyBoardForDate directly — server/src/routes/__tests__/
// daily-board.test.ts covers the same property through the real HTTP route.

const ADDR = "guest_boardguarda";
const OTHER = "guest_boardguardb";

function fundPlayer(address: string) {
  getDb().prepare("INSERT INTO players (radix_address, meme_balance) VALUES (?, 1000)").run(address);
}

describe("boards — once-per-day-per-account guard", () => {
  before(() => {
    runMigrations(getDb());
  });

  beforeEach(() => {
    const db = getDb();
    db.exec("DELETE FROM boards; DELETE FROM players;");
    fundPlayer(ADDR);
    fundPlayer(OTHER);
  });

  after(closeDb);

  it("first call for (address, date) inserts a new row", () => {
    const result = createDailyBoardOnce(ADDR, generateGrid(1), "2026-08-13");
    assert.equal(result.created, true);
    assert.equal(result.board.is_daily, 1);
    assert.equal(result.board.daily_date, "2026-08-13");
  });

  it("a second call for the SAME (address, date) is idempotent — same board, no new row", () => {
    const first = createDailyBoardOnce(ADDR, generateGrid(1), "2026-08-13");
    const second = createDailyBoardOnce(ADDR, generateGrid(2), "2026-08-13");

    assert.equal(second.created, false, "must report it did not insert");
    assert.equal(second.board.id, first.board.id, "must return the existing board, not a new one");

    const count = (
      getDb()
        .prepare("SELECT COUNT(*) AS n FROM boards WHERE radix_address = ? AND is_daily = 1")
        .get(ADDR) as { n: number }
    ).n;
    assert.equal(count, 1, "exactly one daily row for this account+date, ever");
  });

  it("a DIFFERENT date for the same account is allowed — a fresh row", () => {
    const day1 = createDailyBoardOnce(ADDR, generateGrid(1), "2026-08-13");
    const day2 = createDailyBoardOnce(ADDR, generateGrid(2), "2026-08-14");

    assert.equal(day1.created, true);
    assert.equal(day2.created, true);
    assert.notEqual(day1.board.id, day2.board.id);
  });

  it("a DIFFERENT account, same date, is allowed — the guard is per-account", () => {
    const a = createDailyBoardOnce(ADDR, generateGrid(1), "2026-08-13");
    const b = createDailyBoardOnce(OTHER, generateGrid(1), "2026-08-13");

    assert.equal(a.created, true);
    assert.equal(b.created, true);
    assert.notEqual(a.board.id, b.board.id);
    assert.deepEqual(a.board.grid, b.board.grid, "same seed -> same layout for both accounts");
  });

  it("the idempotent return still finds the board once it is no longer active", () => {
    const created = createDailyBoardOnce(ADDR, generateGrid(1), "2026-08-13");
    // Simulate the player finishing (or abandoning) today's daily board —
    // getActiveBoard would no longer find it, but the day-guard must.
    const board = created.board;
    board.status = "completed";
    updateBoard(board);
    assert.equal(getActiveBoard(ADDR), null);

    const found = getDailyBoardForDate(ADDR, "2026-08-13");
    assert.ok(found, "a completed daily board must still be found by date");
    assert.equal(found!.id, created.board.id);

    const again = createDailyBoardOnce(ADDR, generateGrid(2), "2026-08-13");
    assert.equal(again.created, false, "still idempotent after completion — no replay of a known board");
    assert.equal(again.board.id, created.board.id);
  });

  it("DB constraint (not just app logic) rejects a duplicate raw INSERT", () => {
    createDailyBoardOnce(ADDR, generateGrid(1), "2026-08-13");
    assert.throws(
      () =>
        getDb()
          .prepare("INSERT INTO boards (radix_address, grid, is_daily, daily_date) VALUES (?, ?, 1, ?)")
          .run(ADDR, JSON.stringify(generateGrid(2)), "2026-08-13"),
      /UNIQUE constraint failed/i,
      "the unique index must reject this even bypassing createDailyBoardOnce entirely"
    );
  });

  it("non-daily boards (is_daily = 0) are never constrained by the daily index", () => {
    const db = getDb();
    // Same address, no daily_date (NULL) — must be able to insert as many of
    // these as the rest of the app allows; the partial index only covers
    // is_daily = 1 rows.
    const insert = db.prepare("INSERT INTO boards (radix_address, grid) VALUES (?, ?)");
    assert.doesNotThrow(() => insert.run(ADDR, JSON.stringify(generateGrid(1))));
    assert.doesNotThrow(() => insert.run(ADDR, JSON.stringify(generateGrid(2))));
  });
});
