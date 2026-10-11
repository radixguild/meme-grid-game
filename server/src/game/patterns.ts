// Line and pattern detection for bonus rewards on the 8x8 grid

import type { Cell } from "./grid";
import { GRID_SIZE } from "./grid";

export interface LineBonus {
  type: "row" | "col" | "diagonal";
  index: number; // row/col number, or 0=main diag, 1=anti diag
  reward: number;
  xp: number;
  label: string;
}

export interface PatternBonus {
  type: string;
  reward: number;
  xp: number;
  label: string;
  emoji: string;
}

export interface ComboResult {
  lines: LineBonus[];
  patterns: PatternBonus[];
  comboMultiplier: number;
  totalBonusScore: number;
  totalBonusXp: number;
  message: string;
}

function isRowComplete(grid: Cell[][], row: number): boolean {
  return grid[row].every((c) => c.completed);
}

function isColComplete(grid: Cell[][], col: number): boolean {
  for (let r = 0; r < GRID_SIZE; r++) {
    if (!grid[r][col].completed) return false;
  }
  return true;
}

function isMainDiagComplete(grid: Cell[][]): boolean {
  for (let i = 0; i < GRID_SIZE; i++) {
    if (!grid[i][i].completed) return false;
  }
  return true;
}

function isAntiDiagComplete(grid: Cell[][]): boolean {
  for (let i = 0; i < GRID_SIZE; i++) {
    if (!grid[i][GRID_SIZE - 1 - i].completed) return false;
  }
  return true;
}

/**
 * Check for newly completed lines after a cell completion.
 * Only returns lines that were JUST completed (the completed cell is part of them).
 */
export function checkNewLines(grid: Cell[][], completedRow: number, completedCol: number): LineBonus[] {
  const lines: LineBonus[] = [];

  if (isRowComplete(grid, completedRow)) {
    lines.push({
      type: "row",
      index: completedRow,
      reward: 25,
      xp: 30,
      label: `Row ${completedRow + 1} complete!`,
    });
  }

  if (isColComplete(grid, completedCol)) {
    lines.push({
      type: "col",
      index: completedCol,
      reward: 25,
      xp: 30,
      label: `Column ${completedCol + 1} complete!`,
    });
  }

  if (completedRow === completedCol && isMainDiagComplete(grid)) {
    lines.push({
      type: "diagonal",
      index: 0,
      reward: 50,
      xp: 60,
      label: "Main diagonal complete!",
    });
  }

  if (completedRow + completedCol === GRID_SIZE - 1 && isAntiDiagComplete(grid)) {
    lines.push({
      type: "diagonal",
      index: 1,
      reward: 50,
      xp: 60,
      label: "Anti-diagonal complete!",
    });
  }

  return lines;
}

/** Is (row, col) one of the four corners? */
function isCorner(row: number, col: number): boolean {
  return (row === 0 || row === GRID_SIZE - 1) && (col === 0 || col === GRID_SIZE - 1);
}

/** Is (row, col) on the outer border? */
function isBorder(row: number, col: number): boolean {
  return row === 0 || col === 0 || row === GRID_SIZE - 1 || col === GRID_SIZE - 1;
}

/** Is (row, col) inside the centre 4x4 block? */
function isCenter(row: number, col: number): boolean {
  return row >= 2 && row < 6 && col >= 2 && col < 6;
}

/** Is (row, col) on either diagonal? */
function isOnDiagonal(row: number, col: number): boolean {
  return row === col || row + col === GRID_SIZE - 1;
}

/**
 * Pattern bonuses earned by JUST completing the cell at (completedRow, completedCol).
 *
 * Scoped to the completed cell for the same reason checkNewLines is: a pattern
 * becomes true at the exact moment its last member cell completes, and cells never
 * un-complete, so membership + "is now true" means "was just earned". That makes
 * each pattern payable exactly once per board, without needing to remember what was
 * already paid.
 *
 * It did not used to be scoped. checkPatterns(grid) evaluated the whole board and
 * returned everything currently true, and engine.ts paid all of it on EVERY cell
 * completion — so once the four corners were done, "Four Corners!" re-fired for the
 * rest of the board. Measured on a grid with the corners pre-completed: 12 rolls,
 * 12 more awards, +360 score and +480 XP from one already-earned pattern. Since XP
 * drives levels and levels pay ROLLS, that inflated the currency faucet too, and
 * routes/powerups.ts could re-trigger it at zero cost with a power-up that completes
 * no cell at all.
 */
export function checkPatterns(
  grid: Cell[][],
  completedRow: number,
  completedCol: number,
): PatternBonus[] {
  const patterns: PatternBonus[] = [];

  // Four corners
  if (
    isCorner(completedRow, completedCol) &&
    grid[0][0].completed &&
    grid[0][GRID_SIZE - 1].completed &&
    grid[GRID_SIZE - 1][0].completed &&
    grid[GRID_SIZE - 1][GRID_SIZE - 1].completed
  ) {
    patterns.push({
      type: "corners",
      reward: 30,
      xp: 40,
      label: "Four Corners!",
      emoji: "\ud83d\udca0",
    });
  }

  // Full border (all edge cells)
  let borderComplete = isBorder(completedRow, completedCol);
  for (let i = 0; borderComplete && i < GRID_SIZE; i++) {
    if (
      !grid[0][i].completed ||
      !grid[GRID_SIZE - 1][i].completed ||
      !grid[i][0].completed ||
      !grid[i][GRID_SIZE - 1].completed
    ) {
      borderComplete = false;
      break;
    }
  }
  if (borderComplete) {
    patterns.push({
      type: "border",
      reward: 100,
      xp: 120,
      label: "Full Border!",
      emoji: "\ud83d\uddbc\ufe0f",
    });
  }

  // Center 4x4 block
  let centerComplete = isCenter(completedRow, completedCol);
  for (let r = 2; centerComplete && r < 6; r++) {
    for (let c = 2; c < 6; c++) {
      if (!grid[r][c].completed) { centerComplete = false; break; }
    }
    if (!centerComplete) break;
  }
  if (centerComplete) {
    patterns.push({
      type: "center",
      reward: 60,
      xp: 80,
      label: "Center Block!",
      emoji: "\ud83c\udfaf",
    });
  }

  // X pattern (both diagonals)
  if (isOnDiagonal(completedRow, completedCol) && isMainDiagComplete(grid) && isAntiDiagComplete(grid)) {
    patterns.push({
      type: "x_pattern",
      reward: 80,
      xp: 100,
      label: "X Pattern!",
      emoji: "\u274c",
    });
  }

  // Blackout (all 64 cells) — this is the jackpot
  let allComplete = true;
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (!grid[r][c].completed) { allComplete = false; break; }
    }
    if (!allComplete) break;
  }
  if (allComplete) {
    patterns.push({
      type: "blackout",
      reward: 500,
      xp: 1000,
      label: "BLACKOUT! All 64 cells!",
      emoji: "\ud83c\udf1f",
    });
  }

  return patterns;
}

/**
 * Calculate combo multiplier based on number of lines completed simultaneously
 */
export function getComboMultiplier(lineCount: number): number {
  if (lineCount <= 1) return 1;
  if (lineCount === 2) return 2.5;
  if (lineCount === 3) return 4;
  return Math.min(5 + (lineCount - 3), 10); // Cap at 10x
}

/**
 * Near-miss detection — returns cells that are 1 away from completing a line
 */
export function getNearMisses(grid: Cell[][]): Array<{ type: string; remaining: { row: number; col: number } }> {
  const nearMisses: Array<{ type: string; remaining: { row: number; col: number } }> = [];

  // Check rows
  for (let r = 0; r < GRID_SIZE; r++) {
    const incomplete = grid[r].reduce((acc, c, idx) => {
      if (!c.completed) acc.push({ row: r, col: idx });
      return acc;
    }, [] as Array<{ row: number; col: number }>);
    if (incomplete.length === 1) {
      nearMisses.push({ type: `Row ${r + 1}`, remaining: incomplete[0] });
    }
  }

  // Check columns
  for (let c = 0; c < GRID_SIZE; c++) {
    const incomplete: Array<{ row: number; col: number }> = [];
    for (let r = 0; r < GRID_SIZE; r++) {
      if (!grid[r][c].completed) incomplete.push({ row: r, col: c });
    }
    if (incomplete.length === 1) {
      nearMisses.push({ type: `Col ${c + 1}`, remaining: incomplete[0] });
    }
  }

  // Check diagonals
  const mainDiagIncomplete: Array<{ row: number; col: number }> = [];
  const antiDiagIncomplete: Array<{ row: number; col: number }> = [];
  for (let i = 0; i < GRID_SIZE; i++) {
    if (!grid[i][i].completed) mainDiagIncomplete.push({ row: i, col: i });
    if (!grid[i][GRID_SIZE - 1 - i].completed) antiDiagIncomplete.push({ row: i, col: GRID_SIZE - 1 - i });
  }
  if (mainDiagIncomplete.length === 1) {
    nearMisses.push({ type: "Main Diagonal", remaining: mainDiagIncomplete[0] });
  }
  if (antiDiagIncomplete.length === 1) {
    nearMisses.push({ type: "Anti-Diagonal", remaining: antiDiagIncomplete[0] });
  }

  return nearMisses;
}
