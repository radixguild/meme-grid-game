import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { executeRowBomb, executeCellSwap, getMagnetTargets, selectSwapTarget } from "../powerups";
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

describe("executeRowBomb", () => {
  it("completes all cells in the most incomplete row", () => {
    const grid = makeGrid();
    // Complete most of row 0 so row 1 (all incomplete) gets bombed
    for (let c = 0; c < 6; c++) {
      grid[0][c].completed = true;
      grid[0][c].hits = 1;
    }
    const result = executeRowBomb(grid);
    // Should pick a row with 8 incomplete cells (not row 0 which only has 2)
    assert.ok(result.cellsCompleted === 8);
    assert.ok(result.scoreChange > 0);
    assert.ok(result.xpEarned > 0);
  });

  it("marks all bombed cells as completed", () => {
    const grid = makeGrid();
    const result = executeRowBomb(grid);
    for (let c = 0; c < GRID_SIZE; c++) {
      assert.ok(grid[result.row][c].completed);
    }
  });

  it("throws when all rows are complete", () => {
    const grid = makeGrid();
    for (const row of grid) {
      for (const cell of row) {
        cell.completed = true;
      }
    }
    assert.throws(() => executeRowBomb(grid), /No incomplete rows/);
  });

  it("handles rug_pull cells (negative reward)", () => {
    const grid = makeGrid();
    // Make entire row rug_pulls
    for (let c = 0; c < GRID_SIZE; c++) {
      grid[0][c].type = "rug_pull";
    }
    // Complete all other rows so row 0 is the only option
    for (let r = 1; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        grid[r][c].completed = true;
      }
    }
    const result = executeRowBomb(grid);
    assert.equal(result.row, 0);
    assert.ok(result.scoreChange < 0, "Rug pull row should have negative score");
  });
});

describe("executeCellSwap", () => {
  it("swaps rug_pull to normal", () => {
    const grid = makeGrid();
    grid[2][3].type = "rug_pull";
    const result = executeCellSwap(grid, 2, 3);
    assert.ok(result);
    assert.equal(grid[2][3].type, "normal");
  });

  it("returns false for non-rug_pull cell", () => {
    const grid = makeGrid();
    const result = executeCellSwap(grid, 0, 0);
    assert.ok(!result);
    assert.equal(grid[0][0].type, "normal"); // unchanged
  });

  it("returns false for completed rug_pull", () => {
    const grid = makeGrid();
    grid[1][1].type = "rug_pull";
    grid[1][1].completed = true;
    const result = executeCellSwap(grid, 1, 1);
    assert.ok(!result);
  });

  it("returns false for out of bounds", () => {
    const grid = makeGrid();
    assert.ok(!executeCellSwap(grid, -1, 0));
    assert.ok(!executeCellSwap(grid, 0, 8));
  });
});

describe("selectSwapTarget", () => {
  it("selects the incomplete rug pull with the highest hits", () => {
    const grid = makeGrid();
    grid[1][2] = { type: "rug_pull", hits: 1, threshold: 2, completed: false };
    grid[3][4] = { type: "rug_pull", hits: 2, threshold: 2, completed: false };
    assert.deepEqual(selectSwapTarget(grid), { row: 3, col: 4 });
  });

  it("breaks ties in row-major order", () => {
    const grid = makeGrid();
    grid[2][3] = { type: "rug_pull", hits: 1, threshold: 2, completed: false };
    grid[2][1] = { type: "rug_pull", hits: 1, threshold: 2, completed: false };
    grid[1][7] = { type: "rug_pull", hits: 1, threshold: 2, completed: false };
    assert.deepEqual(selectSwapTarget(grid), { row: 1, col: 7 });
  });

  it("returns null without incomplete rug pulls and excludes completed ones", () => {
    const grid = makeGrid();
    grid[0][0] = { type: "rug_pull", hits: 1, threshold: 1, completed: true };
    assert.equal(selectSwapTarget(grid), null);
  });
});

describe("getMagnetTargets", () => {
  it("returns cells sorted by completion progress", () => {
    const grid = makeGrid();
    grid[0][0].hits = 1;
    grid[0][0].threshold = 2; // 50%
    grid[1][1].hits = 0;
    grid[1][1].threshold = 2; // 0%
    grid[2][2].hits = 1;
    grid[2][2].threshold = 1; // 100% but not marked completed yet — edge case
    grid[2][2].completed = false;

    const targets = getMagnetTargets(grid, 3);
    // grid[2][2] should be first (100% progress), then grid[0][0] (50%)
    assert.equal(targets[0].row, 2);
    assert.equal(targets[0].col, 2);
    assert.equal(targets[1].row, 0);
    assert.equal(targets[1].col, 0);
  });

  it("excludes completed cells", () => {
    const grid = makeGrid();
    grid[0][0].completed = true;
    const targets = getMagnetTargets(grid, 64);
    assert.ok(!targets.some((t) => t.row === 0 && t.col === 0));
    assert.equal(targets.length, 63);
  });

  it("respects count limit", () => {
    const grid = makeGrid();
    const targets = getMagnetTargets(grid, 5);
    assert.equal(targets.length, 5);
  });
});
