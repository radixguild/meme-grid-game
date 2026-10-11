// Weighted dice roll (1-6)
// 1: 30% (miss), 2: 25%, 3: 20%, 4: 13%, 5: 8%, 6: 4% (jackpot)

import { randomIndex } from "./secure-random";

const DICE_WEIGHTS = [
  { value: 1, weight: 30 },
  { value: 2, weight: 25 },
  { value: 3, weight: 20 },
  { value: 4, weight: 13 },
  { value: 5, weight: 8 },
  { value: 6, weight: 4 },
];

const DICE_POOL: number[] = [];
for (const { value, weight } of DICE_WEIGHTS) {
  for (let i = 0; i < weight; i++) DICE_POOL.push(value);
}

export interface DiceResult {
  value: number;
  label: string;
  bonusXp: number;
}

const DICE_LABELS: Record<number, { label: string; bonusXp: number }> = {
  // NOT "Miss". The die does not decide whether a cell is hit — engine.ts advances
  // the cell on every roll regardless of value (see docs/GAME-DESIGN-REVIEW.md §1.3),
  // so labelling a 1 as a miss told the player something that did not happen. What a
  // 1 actually means is "no bonus XP", which is what it now says. If the parked
  // real-dice change ever ships and a 1 genuinely misses, rename this back.
  1: { label: "No bonus", bonusXp: 0 },
  2: { label: "Small", bonusXp: 5 },
  3: { label: "Nice", bonusXp: 10 },
  4: { label: "Great", bonusXp: 25 },
  5: { label: "Epic", bonusXp: 50 },
  6: { label: "Jackpot", bonusXp: 100 },
};

export function rollDice(): DiceResult {
  const value = DICE_POOL[randomIndex(DICE_POOL.length)];
  const { label, bonusXp } = DICE_LABELS[value];
  return { value, label, bonusXp };
}
