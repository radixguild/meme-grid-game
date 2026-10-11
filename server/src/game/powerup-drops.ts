// Power-up drop system — earned through gameplay

import type { PowerUpType } from "./powerups";
import { randomIndex, rollChance } from "./secure-random";

interface PowerUpDrop {
  type: PowerUpType;
  reason: string;
}

// Random drop table — weighted chances on cell completion
// ~15% chance to get a power-up per cell completed
const DROP_TABLE: Array<{ type: PowerUpType; weight: number }> = [
  { type: "reroll", weight: 40 },     // Most common drop
  { type: "x_ray", weight: 25 },
  { type: "swap", weight: 20 },
  { type: "magnet", weight: 10 },
  { type: "row_bomb", weight: 5 },    // Rarest drop
];

const DROP_POOL: PowerUpType[] = [];
for (const { type, weight } of DROP_TABLE) {
  for (let i = 0; i < weight; i++) DROP_POOL.push(type);
}

/**
 * Check if a power-up drops on cell completion.
 * ~15% chance per cell completed.
 */
export function rollForDrop(): PowerUpDrop | null {
  if (!rollChance(0.15)) return null; // 85% chance of no drop
  const type = DROP_POOL[randomIndex(DROP_POOL.length)];
  return { type, reason: "cell_complete_drop" };
}

// Milestone awards — guaranteed power-ups at specific cell counts
const MILESTONE_AWARDS: Record<number, PowerUpDrop> = {
  8: { type: "x_ray", reason: "8 cells — X-Ray unlocked!" },
  16: { type: "reroll", reason: "16 cells — Re-Roll earned!" },
  24: { type: "swap", reason: "24 cells — Swap earned!" },
  32: { type: "magnet", reason: "32 cells — halfway! Magnet earned!" },
  48: { type: "reroll", reason: "48 cells — almost there! Re-Roll earned!" },
  56: { type: "row_bomb", reason: "56 cells — Row Bomb for the final push!" },
};

/**
 * Check if a milestone power-up should be awarded.
 */
export function checkMilestone(cellsCompleted: number): PowerUpDrop | null {
  return MILESTONE_AWARDS[cellsCompleted] || null;
}
