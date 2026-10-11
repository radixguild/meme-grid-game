// Grid generation — 8x8 weighted random cell assignment

import { randomUnit } from "./secure-random";

export type CellType =
  | "normal"
  | "double_score"
  | "extra_turn"
  | "wild"
  | "rug_pull"
  | "pepe_bonus"
  | "otter"
  | "diamond"
  | "moon";

export interface CellConfig {
  emoji: string;
  weight: number;
  reward: number;
  xp: number;
  description: string;
}

export const CELL_TYPES: Record<CellType, CellConfig> = {
  normal: { emoji: "\u2b1c", weight: 40, reward: 10, xp: 10, description: "Standard cell" },
  double_score: { emoji: "\ud83d\ude80", weight: 15, reward: 20, xp: 10, description: "Double score! 2x coins" },
  extra_turn: { emoji: "\ud83c\udf81", weight: 12, reward: 10, xp: 10, description: "Extra turn \u2014 roll refunded" },
  wild: { emoji: "\ud83c\udccf", weight: 8, reward: 15, xp: 10, description: "Wild card \u2014 choose a cell" },
  rug_pull: { emoji: "\ud83d\udc80", weight: 10, reward: -15, xp: 5, description: "Rug pull! Lose score" },
  pepe_bonus: { emoji: "\ud83d\udc38", weight: 8, reward: 10, xp: 25, description: "Pepe bonus \u2014 extra XP" },
  otter: { emoji: "\ud83e\udda6", weight: 5, reward: 15, xp: 30, description: "Purple otter \u2014 Radix mascot bonus" },
  diamond: { emoji: "\ud83d\udc8e", weight: 4, reward: 30, xp: 50, description: "Diamond jackpot!" },
  moon: { emoji: "\ud83c\udf19", weight: 3, reward: 50, xp: 100, description: "Moon \u2014 huge XP + NFT chance" },
};

// Pre-compute weighted pool for O(1) picks
const WEIGHT_POOL: CellType[] = [];
for (const [type, cfg] of Object.entries(CELL_TYPES)) {
  for (let i = 0; i < cfg.weight; i++) WEIGHT_POOL.push(type as CellType);
}

/**
 * Deterministic PRNG (mulberry32) — used ONLY when generateGrid() is given a
 * seed (the Daily Challenge). Every unseeded call draws from the CSPRNG in
 * ./secure-random instead.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function random(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickCellType(rand: () => number): CellType {
  return WEIGHT_POOL[Math.floor(rand() * WEIGHT_POOL.length)];
}

// Hit threshold: 1(40%) or 2(60%)
// Quick completions — feels rewarding. Each roll adds exactly one hit to one
// incomplete cell, so a board takes exactly (sum of the 64 thresholds) rolls:
// mean 102.4, and bounded to 64-128 by construction. The long-standing
// "~100-150" figure overstated the top end; 150 cannot happen.
function pickThreshold(rand: () => number): number {
  return rand() < 0.4 ? 1 : 2;
}

export interface Cell {
  type: CellType;
  hits: number;
  threshold: number;
  completed: boolean;
}

export const GRID_SIZE = 8;

/**
 * Generate an 8x8 board. With no `seed`, every cell is picked from the
 * CSPRNG (./secure-random), so a layout cannot be predicted from earlier draws.
 * With a `seed` (see `getDailySeed()`), generation is fully
 * deterministic: the same seed always produces the same grid, cell for cell.
 */
export function generateGrid(seed?: number): Cell[][] {
  const rand = seed === undefined ? randomUnit : mulberry32(seed);
  const grid: Cell[][] = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    const row: Cell[] = [];
    for (let c = 0; c < GRID_SIZE; c++) {
      row.push({
        type: pickCellType(rand),
        hits: 0,
        threshold: pickThreshold(rand),
        completed: false,
      });
    }
    grid.push(row);
  }
  return grid;
}

/**
 * UTC calendar date string (YYYY-MM-DD) for "today". Exported so callers that
 * need to key something else off the same date `getDailySeed()` uses (e.g. the
 * once-per-day-per-account board guard in db/queries/boards.ts) compute it once
 * and pass it explicitly, rather than each calling `new Date()` independently —
 * two separate calls straddling UTC midnight could otherwise disagree by a day.
 */
export function todayUtcDate(): string {
  return new Date().toISOString().split("T")[0];
}

let warnedMissingDailySeedSalt = false;

/**
 * Server-side secret mixed into the daily seed (env `DAILY_SEED_SALT`).
 *
 * Read fresh on every call (not cached at module load) rather than following
 * this file's usual "const X = process.env.X" pattern — this keeps the salt
 * swappable within a running process (ops rotating it, or tests exercising
 * multiple values) without a restart or module-cache trick.
 *
 * Missing salt is NOT fatal: this must never crash a live game over an
 * optional env var. It logs a warning once per process instead and falls back
 * to the unsalted date-only hash — see the gotcha in docs/PROJECT-STATE.md.
 */
function dailySeedSalt(): string {
  const salt = process.env.DAILY_SEED_SALT;
  if (salt) return salt;

  if (!warnedMissingDailySeedSalt) {
    warnedMissingDailySeedSalt = true;
    console.warn(
      "[daily-seed] DAILY_SEED_SALT is not set — the Daily Challenge seed is a " +
        "bare FNV-1a hash of the UTC date, precomputable by anyone with source " +
        "access. Fine for local/dev. Set DAILY_SEED_SALT before daily rewards " +
        "carry real value in production."
    );
  }
  return "";
}

/**
 * Deterministic seed for a UTC calendar date (default: today), so every
 * player who starts a Daily Challenge board on the same day gets the
 * identical grid, and the grid changes at UTC midnight.
 *
 * Uses an FNV-1a hash rather than a plain character-code sum. A sum is
 * order-insensitive — e.g. "2026-08-13" and "2026-08-31" contain the exact
 * same digits and would hash identically, silently reusing one day's board on
 * another. FNV-1a folds in position, so distinct dates reliably produce
 * distinct seeds.
 *
 * A secret salt (env `DAILY_SEED_SALT`) is mixed into the hashed string when
 * set, so the seed is no longer reproducible from source + date alone — see
 * `dailySeedSalt()`. When unset, the hash is exactly the bare date hash (no
 * separator byte added), so an unsalted deploy is bit-for-bit unchanged from
 * before this existed; setting or rotating the salt changes the seed — and
 * therefore the layout — for boards created from that point on. Boards
 * already created keep the grid they were dealt; this only affects future
 * `getDailySeed()` calls, never a stored board.
 */
export function getDailySeed(date: Date | string = new Date()): number {
  const dateStr = typeof date === "string" ? date : date.toISOString().split("T")[0];
  const salt = dailySeedSalt();
  const input = salt ? `${dateStr}:${salt}` : dateStr;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}
