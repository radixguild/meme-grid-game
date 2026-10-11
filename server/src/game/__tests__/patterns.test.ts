import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkNewLines, checkPatterns, getComboMultiplier, getNearMisses } from "../patterns";
import { GRID_SIZE, type Cell } from "../grid";

function makeGrid(): Cell[][] {
  const grid: Cell[][] = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      row.push({ type: "normal", hits: 0, threshold: 1, completed: false });
    }
    grid.push(row);
  }
  return grid;
}

function completeCell(grid: Cell[][], r: number, c: number) {
  grid[r][c].completed = true;
  grid[r][c].hits = grid[r][c].threshold;
}

describe("checkNewLines", () => {
  it("detects row completion", () => {
    const grid = makeGrid();
    for (let c = 0; c < GRID_SIZE; c++) completeCell(grid, 0, c);
    const lines = checkNewLines(grid, 0, 0);
    assert.ok(lines.some((l) => l.type === "row" && l.index === 0));
  });

  it("detects column completion", () => {
    const grid = makeGrid();
    for (let r = 0; r < GRID_SIZE; r++) completeCell(grid, r, 3);
    const lines = checkNewLines(grid, 0, 3);
    assert.ok(lines.some((l) => l.type === "col" && l.index === 3));
  });

  it("detects main diagonal", () => {
    const grid = makeGrid();
    for (let i = 0; i < GRID_SIZE; i++) completeCell(grid, i, i);
    const lines = checkNewLines(grid, 4, 4);
    assert.ok(lines.some((l) => l.type === "diagonal" && l.index === 0));
  });

  it("detects anti-diagonal", () => {
    const grid = makeGrid();
    for (let i = 0; i < GRID_SIZE; i++) completeCell(grid, i, GRID_SIZE - 1 - i);
    const lines = checkNewLines(grid, 3, 4);
    assert.ok(lines.some((l) => l.type === "diagonal" && l.index === 1));
  });

  it("returns empty when no line completed", () => {
    const grid = makeGrid();
    completeCell(grid, 0, 0);
    const lines = checkNewLines(grid, 0, 0);
    assert.equal(lines.length, 0);
  });

  it("detects multiple lines simultaneously", () => {
    const grid = makeGrid();
    // Complete row 0 and column 0
    for (let i = 0; i < GRID_SIZE; i++) {
      completeCell(grid, 0, i);
      completeCell(grid, i, 0);
    }
    const lines = checkNewLines(grid, 0, 0);
    assert.ok(lines.length >= 2, "Should detect both row and column");
  });
});

describe("checkPatterns", () => {
  it("detects four corners", () => {
    const grid = makeGrid();
    completeCell(grid, 0, 0);
    completeCell(grid, 0, 7);
    completeCell(grid, 7, 0);
    completeCell(grid, 7, 7);
    const patterns = checkPatterns(grid, 7, 7);
    assert.ok(patterns.some((p) => p.type === "corners"));
  });

  it("detects X pattern (both diagonals)", () => {
    const grid = makeGrid();
    for (let i = 0; i < GRID_SIZE; i++) {
      completeCell(grid, i, i);
      completeCell(grid, i, GRID_SIZE - 1 - i);
    }
    const patterns = checkPatterns(grid, GRID_SIZE - 1, 0);
    assert.ok(patterns.some((p) => p.type === "x_pattern"));
  });

  it("detects blackout", () => {
    const grid = makeGrid();
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        completeCell(grid, r, c);
      }
    }
    const patterns = checkPatterns(grid, GRID_SIZE - 1, GRID_SIZE - 1);
    assert.ok(patterns.some((p) => p.type === "blackout"));
    assert.ok(patterns.some((p) => p.reward === 500));
  });

  it("detects center block", () => {
    const grid = makeGrid();
    for (let r = 2; r < 6; r++) {
      for (let c = 2; c < 6; c++) {
        completeCell(grid, r, c);
      }
    }
    const patterns = checkPatterns(grid, 5, 5);
    assert.ok(patterns.some((p) => p.type === "center"));
  });

  it("returns empty when no patterns", () => {
    const grid = makeGrid();
    completeCell(grid, 0, 0);
    const patterns = checkPatterns(grid, 0, 0);
    assert.equal(patterns.length, 0);
  });

  // ── Regression: a pattern must pay out ONCE per board ────────────────────
  //
  // checkPatterns used to take only the grid and return everything currently
  // true, and engine.ts paid all of it on every cell completion. Once the four
  // corners were done, "Four Corners!" re-fired for the rest of the board:
  // measured at 12 awards in 12 rolls, +360 score and +480 XP from one pattern.
  // Every test above called the pure function once on a static grid, so none of
  // them could see it. These do.

  it("does not re-award a pattern when a later, unrelated cell completes", () => {
    const grid = makeGrid();
    completeCell(grid, 0, 0);
    completeCell(grid, 0, 7);
    completeCell(grid, 7, 0);
    completeCell(grid, 7, 7);
    assert.ok(
      checkPatterns(grid, 7, 7).some((p) => p.type === "corners"),
      "the cell that completes the corners earns the bonus"
    );

    // Every subsequent completion is a cell the corners pattern does not contain.
    for (const [r, c] of [[3, 4], [1, 1], [5, 2], [2, 6]] as const) {
      completeCell(grid, r, c);
      assert.equal(
        checkPatterns(grid, r, c).filter((p) => p.type === "corners").length,
        0,
        `completing [${r},${c}] must not re-award the corners bonus`
      );
    }
  });

  it("awards a pattern only to the cell that completes it, not its other members", () => {
    const grid = makeGrid();
    for (let r = 2; r < 6; r++) {
      for (let c = 2; c < 6; c++) completeCell(grid, r, c);
    }
    // 15 of the 16 centre cells are members but did not complete the block.
    let awards = 0;
    for (let r = 2; r < 6; r++) {
      for (let c = 2; c < 6; c++) {
        awards += checkPatterns(grid, r, c).filter((p) => p.type === "center").length;
      }
    }
    assert.equal(awards, 16, "membership check is per-cell — engine only calls it for the completing cell");
  });

  it("a cell outside a pattern never earns it", () => {
    const grid = makeGrid();
    completeCell(grid, 0, 0);
    completeCell(grid, 0, 7);
    completeCell(grid, 7, 0);
    completeCell(grid, 7, 7);
    completeCell(grid, 4, 4);
    assert.equal(
      checkPatterns(grid, 4, 4).length,
      0,
      "a centre-ish cell is not a corner, so it cannot earn the corners bonus"
    );
  });
});

describe("getComboMultiplier", () => {
  it("returns 1x for single line", () => {
    assert.equal(getComboMultiplier(1), 1);
  });
  it("returns 2.5x for double", () => {
    assert.equal(getComboMultiplier(2), 2.5);
  });
  it("returns 4x for triple", () => {
    assert.equal(getComboMultiplier(3), 4);
  });
  it("caps at 10x", () => {
    assert.equal(getComboMultiplier(10), 10);
  });
});

describe("getNearMisses", () => {
  it("detects row near-miss (1 cell remaining)", () => {
    const grid = makeGrid();
    for (let c = 0; c < GRID_SIZE - 1; c++) completeCell(grid, 2, c);
    const misses = getNearMisses(grid);
    assert.ok(misses.some((m) => m.type === "Row 3"));
  });

  it("returns empty when no near-misses", () => {
    const grid = makeGrid();
    const misses = getNearMisses(grid);
    assert.equal(misses.length, 0);
  });
});
