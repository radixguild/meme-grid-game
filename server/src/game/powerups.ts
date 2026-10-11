// Power-up system — earned through gameplay, add strategic depth

import type { Cell } from "./grid";
import { GRID_SIZE, CELL_TYPES } from "./grid";

export type PowerUpType = "row_bomb" | "reroll" | "swap" | "magnet" | "x_ray";

export interface PowerUpDef {
  type: PowerUpType;
  name: string;
  emoji: string;
  description: string;
  memeCost: number; // cost in MEME to buy (0 = earn only)
}

export const POWER_UPS: Record<PowerUpType, PowerUpDef> = {
  row_bomb: {
    type: "row_bomb",
    name: "Row Bomb",
    emoji: "\ud83d\udca3",
    description: "Complete all cells in a random row instantly",
    memeCost: 30,
  },
  reroll: {
    type: "reroll",
    name: "Re-Roll",
    emoji: "\ud83d\udd04",
    description: "Re-roll the last dice — get a new random cell hit",
    memeCost: 5,
  },
  swap: {
    type: "swap",
    name: "Cell Swap",
    emoji: "\ud83d\udd00",
    description: "Swap a rug_pull cell type to normal",
    memeCost: 15,
  },
  magnet: {
    type: "magnet",
    name: "Magnet",
    emoji: "\ud83e\uddf2",
    description: "Next 3 rolls target cells that are closest to completion",
    memeCost: 20,
  },
  x_ray: {
    type: "x_ray",
    name: "X-Ray",
    emoji: "\ud83d\udd0d",
    description: "Reveal all hidden cell types for 5 rolls",
    memeCost: 10,
  },
};

/**
 * True only for a real catalog key. POWER_UPS is a plain object, so a bare
 * `POWER_UPS[type]` lookup also "finds" inherited keys — "constructor" is
 * Object, truthy, with no memeCost — and /buy then debited `undefined`, which
 * SQLite stores as NULL and bricks the balance (MG-4). Own keys only.
 */
export function isPowerUpType(value: unknown): value is PowerUpType {
  return typeof value === "string" && Object.hasOwn(POWER_UPS, value);
}

/**
 * Execute Row Bomb — complete all cells in a random incomplete row
 */
export function executeRowBomb(grid: Cell[][]): {
  row: number;
  cellsCompleted: number;
  scoreChange: number;
  xpEarned: number;
} {
  // Find rows with most incomplete cells (maximize value)
  const rowScores = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    const incomplete = grid[r].filter((c) => !c.completed).length;
    if (incomplete > 0) rowScores.push({ row: r, incomplete });
  }

  if (rowScores.length === 0) throw new Error("No incomplete rows");

  // Pick the row with most incomplete cells
  rowScores.sort((a, b) => b.incomplete - a.incomplete);
  const target = rowScores[0];

  let scoreChange = 0;
  let xpEarned = 0;
  let cellsCompleted = 0;

  for (let c = 0; c < GRID_SIZE; c++) {
    const cell = grid[target.row][c];
    if (!cell.completed) {
      cell.hits = cell.threshold;
      cell.completed = true;
      const config = CELL_TYPES[cell.type];
      scoreChange += config.reward;
      xpEarned += config.xp;
      cellsCompleted++;
    }
  }

  return { row: target.row, cellsCompleted, scoreChange, xpEarned };
}

/**
 * Execute Cell Swap — change a rug_pull cell to normal
 */
export function executeCellSwap(grid: Cell[][], row: number, col: number): boolean {
  if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) return false;
  const cell = grid[row][col];
  if (cell.type !== "rug_pull" || cell.completed) return false;
  cell.type = "normal";
  return true;
}

/** Select the most-invested incomplete rug pull, with stable row-major ties. */
export function selectSwapTarget(grid: Cell[][]): { row: number; col: number } | null {
  let target: { row: number; col: number; hits: number } | null = null;
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let col = 0; col < GRID_SIZE; col++) {
      const cell = grid[row][col];
      if (cell.type === "rug_pull" && !cell.completed && (!target || cell.hits > target.hits)) {
        target = { row, col, hits: cell.hits };
      }
    }
  }
  return target && { row: target.row, col: target.col };
}

/**
 * Find the best target cells for Magnet power-up
 * Returns cells closest to completion (highest hits/threshold ratio)
 */
export function getMagnetTargets(grid: Cell[][], count: number): Array<{ row: number; col: number }> {
  const candidates: Array<{ row: number; col: number; progress: number }> = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const cell = grid[r][c];
      if (!cell.completed) {
        candidates.push({ row: r, col: c, progress: cell.hits / cell.threshold });
      }
    }
  }
  candidates.sort((a, b) => b.progress - a.progress);
  return candidates.slice(0, count).map(({ row, col }) => ({ row, col }));
}
