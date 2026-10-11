/**
 * The one source of randomness for every game outcome (MG-3, 2026-10-06).
 *
 * Dice faces, target cells, the target-order shuffle, power-up drops, lucky-drop
 * chance and amount, and unseeded board layouts all draw from here. They used to
 * call Math.random, which in V8 is xorshift128+: its state can be recovered from a
 * short run of observed outputs, and on a quiet server one player sees a nearly
 * unbroken stream of them (dice face, target cell, drop or no drop). With the state
 * in hand a player could burn draws on cheap calls and steer which rolls land
 * jackpots and drops. node:crypto's randomInt is a CSPRNG and is unbiased (it
 * rejection-samples rather than taking a modulo).
 *
 * The deterministic Daily Challenge layout keeps its seeded mulberry32 in grid.ts
 * on purpose: every player must get the same board that day.
 *
 * game/__tests__/secure-random.test.ts fails if Math.random reappears in any outcome module.
 */

import { randomInt } from "node:crypto";

/** Uniform integer in [0, n). Throws on a non-positive or non-integer n. */
export function randomIndex(n: number): number {
  if (!Number.isSafeInteger(n) || n <= 0) {
    throw new RangeError(`randomIndex: n must be a positive integer, got ${n}`);
  }
  return randomInt(n);
}

/** Uniform integer in [min, max] inclusive. */
export function randomIntInclusive(min: number, max: number): number {
  if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max) || max < min) {
    throw new RangeError(`randomIntInclusive: bad range [${min}, ${max}]`);
  }
  return randomInt(min, max + 1);
}

const CHANCE_RESOLUTION = 1_000_000;

/**
 * True with probability `p`, at a resolution of one in a million. p <= 0 (or NaN)
 * is never, p >= 1 is always.
 */
export function rollChance(p: number): boolean {
  if (!(p > 0)) return false;
  if (p >= 1) return true;
  return randomInt(CHANCE_RESOLUTION) < Math.round(p * CHANCE_RESOLUTION);
}

const UNIT_STEPS = 2 ** 47; // randomInt requires max - min < 2^48

/**
 * Uniform float in [0, 1), for code that takes a `() => number` source (the
 * unseeded branch of generateGrid). Prefer randomIndex / rollChance elsewhere.
 */
export function randomUnit(): number {
  return randomInt(UNIT_STEPS) / UNIT_STEPS;
}
