/**
 * Every game outcome draws from the CSPRNG in game/secure-random.ts (MG-3).
 *
 * Two kinds of check: a source scan that fails if Math.random reappears in any
 * outcome module (comments excluded), and runtime checks with Math.random
 * replaced by a thrower, so a call slipped in through a helper also fails.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomIndex, randomIntInclusive, rollChance, randomUnit } from "../secure-random";
import { rollDice } from "../dice";
import { processRoll } from "../engine";
import { rollForDrop } from "../powerup-drops";
import { generateGrid, getDailySeed } from "../grid";

const OUTCOME_MODULES = ["dice.ts", "engine.ts", "powerup-drops.ts", "rewards.ts", "grid.ts", "powerups.ts", "secure-random.ts"];

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("secure-random: no Math.random in game outcome code", () => {
  for (const file of OUTCOME_MODULES) {
    it(`${file} does not call Math.random`, () => {
      const src = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
      assert.doesNotMatch(stripComments(src), /Math\.random/, `${file} uses Math.random`);
    });
  }

  it("rolls, target picks, drops and unseeded grids never touch Math.random at runtime", (t) => {
    t.mock.method(Math, "random", () => {
      throw new Error("Math.random called from game code");
    });
    for (let i = 0; i < 200; i++) rollDice();
    for (let i = 0; i < 200; i++) rollForDrop();
    const grid = generateGrid();
    processRoll(grid, 0, false);
    processRoll(grid, 0, true);
    // The seeded daily board is deterministic and must stay so.
    assert.deepEqual(generateGrid(getDailySeed("2026-10-06")), generateGrid(getDailySeed("2026-10-06")));
  });
});

describe("secure-random: distributions", () => {
  it("rollDice matches its 30/25/20/13/8/4 weights", () => {
    const N = 100_000;
    const counts = new Map<number, number>();
    for (let i = 0; i < N; i++) {
      const v = rollDice().value;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    const expected: Record<number, number> = { 1: 0.3, 2: 0.25, 3: 0.2, 4: 0.13, 5: 0.08, 6: 0.04 };
    for (const [face, p] of Object.entries(expected)) {
      const observed = (counts.get(Number(face)) ?? 0) / N;
      // ~6 standard deviations at N=100k for the widest bucket.
      assert.ok(Math.abs(observed - p) < 0.01, `face ${face}: observed ${observed}, expected ${p}`);
    }
  });

  it("rollChance honours its bounds", () => {
    for (let i = 0; i < 1000; i++) {
      assert.equal(rollChance(0), false);
      assert.equal(rollChance(-1), false);
      assert.equal(rollChance(NaN), false);
      assert.equal(rollChance(1), true);
      assert.equal(rollChance(2), true);
    }
    const N = 50_000;
    let hits = 0;
    for (let i = 0; i < N; i++) if (rollChance(0.15)) hits++;
    assert.ok(Math.abs(hits / N - 0.15) < 0.01, `rollChance(0.15) hit ${hits / N}`);
  });

  it("randomIndex / randomIntInclusive stay in range and reject bad input", () => {
    for (let i = 0; i < 1000; i++) {
      const a = randomIndex(7);
      assert.ok(Number.isInteger(a) && a >= 0 && a < 7);
      const b = randomIntInclusive(100, 103);
      assert.ok(Number.isInteger(b) && b >= 100 && b <= 103);
      const u = randomUnit();
      assert.ok(u >= 0 && u < 1);
    }
    assert.equal(randomIntInclusive(5, 5), 5);
    assert.throws(() => randomIndex(0), RangeError);
    assert.throws(() => randomIndex(1.5), RangeError);
    assert.throws(() => randomIntInclusive(3, 2), RangeError);
  });
});
