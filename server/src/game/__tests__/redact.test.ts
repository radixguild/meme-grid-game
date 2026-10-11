import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactBoard, redactGrid } from "../redact";
import type { Board } from "../../db/queries/boards";
import type { Cell } from "../grid";

function board(xray_remaining = 0): Board {
  const grid: Cell[][] = [[
    { type: "normal", hits: 0, threshold: 1, completed: false },
    { type: "rug_pull", hits: 1, threshold: 2, completed: false },
    { type: "moon", hits: 1, threshold: 1, completed: true },
  ]];
  return { id: 1, radix_address: "guest_test", grid, score: 7, rolls_used: 1, extra_turns: 0, wild_cards: 1, status: "active", cells_completed: 1, lines_completed: 0, patterns_completed: 0, xray_remaining, magnet_remaining: 0, is_daily: 0, daily_date: null, created_at: 1, completed_at: null };
}

describe("board redaction", () => {
  it("conceals all unhit cells without X-Ray", () => {
    const result = redactBoard(board());
    assert.equal(result.grid[0][0].type, null);
    assert.equal(result.grid[0][0].threshold, null);
    assert.ok(result.grid.flat().filter((cell) => !cell.completed).every((cell) => cell.type === null));
  });
  it("reveals all cells with X-Ray", () => {
    const result = redactBoard(board(5));
    assert.equal(result.grid[0][0].type, "normal");
    assert.equal(result.grid[0][0].threshold, 1);
  });
  it("always exposes completed cells", () => {
    const result = redactBoard(board());
    assert.deepEqual(result.grid[0][2], { type: "moon", hits: 1, threshold: 1, completed: true });
  });
  it("shows threshold but not type after a hit", () => {
    const result = redactBoard(board());
    assert.deepEqual(result.grid[0][1], { type: null, hits: 1, threshold: 2, completed: false });
  });
  it("does not mutate the source grid", () => {
    const source = board().grid;
    redactGrid(source, false);
    assert.equal(source[0][0].type, "normal");
  });
  it("passes board fields through while replacing grid", () => {
    const source = board();
    const result = redactBoard(source);
    assert.equal(result.score, source.score);
    assert.equal(result.xray_remaining, source.xray_remaining);
    assert.equal(result.wild_cards, source.wild_cards);
    assert.equal(result.status, source.status);
    assert.notEqual(result.grid, source.grid);
  });
});
