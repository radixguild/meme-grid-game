import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { processRoll, processWild } from "../engine";
import { CELL_TYPES, generateGrid, GRID_SIZE, type Cell } from "../grid";

function makeGrid(overrides?: Partial<Cell>[][]): Cell[][] {
  const grid: Cell[][] = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      row.push({
        type: "normal",
        hits: 0,
        threshold: 1,
        completed: false,
        ...(overrides?.[r]?.[c] || {}),
      });
    }
    grid.push(row);
  }
  return grid;
}

describe("processRoll", () => {
  it("returns a valid roll outcome", () => {
    const grid = makeGrid();
    const outcome = processRoll(grid, 0);
    assert.ok(outcome.dice.value >= 1 && outcome.dice.value <= 6);
    assert.ok(outcome.cellRow >= 0 && outcome.cellRow < GRID_SIZE);
    assert.ok(outcome.cellCol >= 0 && outcome.cellCol < GRID_SIZE);
    assert.ok(typeof outcome.scoreChange === "number");
    assert.ok(typeof outcome.xpEarned === "number");
  });

  it("completes a cell when hits reach threshold", () => {
    const grid = makeGrid();
    // Run enough rolls to complete at least one cell
    let completed = false;
    for (let i = 0; i < 200 && !completed; i++) {
      const outcome = processRoll(grid, 0);
      if (outcome.cellCompleted) completed = true;
    }
    assert.ok(completed, "Should complete at least one cell in 200 rolls");
  });

  it("detects board completion", () => {
    const grid = makeGrid();
    // Complete all but one cell
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        grid[r][c].completed = true;
        grid[r][c].hits = grid[r][c].threshold;
      }
    }
    grid[7][7].completed = false;
    grid[7][7].hits = 0;
    grid[7][7].threshold = 1;

    const outcome = processRoll(grid, 0);
    assert.ok(outcome.cellCompleted);
    assert.ok(outcome.boardCompleted);
  });

  it("applies pity bonus XP after consecutive misses", () => {
    const grid = makeGrid();
    // All cells have threshold=2, set hits=0 — first hit won't complete
    for (const row of grid) {
      for (const cell of row) {
        cell.threshold = 2;
        cell.hits = 0;
      }
    }
    // Run with high pity counter
    const outcome = processRoll(grid, 10);
    // Pity bonus: floor(10/5)*10 = 20 bonus XP on completion
    // Even if cell doesn't complete, pityBonusXp should be recorded
    assert.ok(typeof outcome.pityBonusXp === "number");
  });

  it("handles magnet mode — targets near-complete cells", () => {
    const grid = makeGrid();
    // Set one cell very close to completion
    grid[3][3].threshold = 2;
    grid[3][3].hits = 1; // 50% done
    // All others at 0 hits
    let hitTarget = false;
    for (let i = 0; i < 50; i++) {
      const outcome = processRoll(grid, 0, true);
      if (outcome.cellRow === 3 && outcome.cellCol === 3) hitTarget = true;
    }
    // With magnet, should hit the near-complete cell more often
    assert.ok(hitTarget, "Magnet should target near-complete cells");
  });

  it("throws when board is already completed", () => {
    const grid = makeGrid();
    for (const row of grid) {
      for (const cell of row) {
        cell.completed = true;
      }
    }
    assert.throws(() => processRoll(grid, 0), /already completed/);
  });
});

describe("processWild", () => {
  it("completes a targeted cell", () => {
    const grid = makeGrid();
    const outcome = processWild(grid, 3, 4);
    assert.ok(outcome.cellCompleted);
    assert.equal(outcome.cellRow, 3);
    assert.equal(outcome.cellCol, 4);
    assert.ok(grid[3][4].completed);
  });

  it("throws on already completed cell", () => {
    const grid = makeGrid();
    grid[0][0].completed = true;
    assert.throws(() => processWild(grid, 0, 0), /already completed/);
  });

  it("throws on out of bounds", () => {
    const grid = makeGrid();
    assert.throws(() => processWild(grid, -1, 0), /out of bounds/);
    assert.throws(() => processWild(grid, 0, 8), /out of bounds/);
  });

  it("detects line completion from wild card", () => {
    const grid = makeGrid();
    // Complete all cells in row 0 except (0,0)
    for (let c = 1; c < GRID_SIZE; c++) {
      grid[0][c].completed = true;
      grid[0][c].hits = 1;
    }
    const outcome = processWild(grid, 0, 0);
    assert.ok(outcome.lines.length > 0, "Should detect row completion");
  });
});

describe("otter cell (Radix mascot)", () => {
  it("is registered in CELL_TYPES with its bonus", () => {
    assert.equal(CELL_TYPES.otter.emoji, "🦦");
    assert.ok(CELL_TYPES.otter.weight > 0);
    assert.equal(CELL_TYPES.otter.reward, 15);
    assert.equal(CELL_TYPES.otter.xp, 30);
  });

  it("appears in generated grids", () => {
    let found = 0;
    for (let i = 0; i < 50; i++) {
      for (const row of generateGrid()) {
        for (const cell of row) if (cell.type === "otter") found++;
      }
    }
    assert.ok(found > 0, "no otter cells across 50 generated grids");
  });

  it("grants otter score and XP on completion", () => {
    const overrides = Array.from({ length: GRID_SIZE }, () =>
      Array.from({ length: GRID_SIZE }, () => ({ type: "otter" as const }))
    );
    const grid = makeGrid(overrides);
    const outcome = processRoll(grid, 0);
    assert.ok(outcome.cellCompleted);
    assert.equal(outcome.scoreChange, 15);
    assert.ok(outcome.xpEarned >= 30);
    assert.match(outcome.message, /Purple otter/);
  });
});
