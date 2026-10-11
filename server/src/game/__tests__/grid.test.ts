import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateGrid, getDailySeed, GRID_SIZE, CELL_TYPES } from "../grid";

function flatten(grid: ReturnType<typeof generateGrid>) {
  return grid.flat();
}

describe("generateGrid — unseeded (non-daily) boards", () => {
  it("produces a GRID_SIZE x GRID_SIZE board of valid cells", () => {
    const grid = generateGrid();
    assert.equal(grid.length, GRID_SIZE);
    for (const row of grid) {
      assert.equal(row.length, GRID_SIZE);
      for (const cell of row) {
        assert.ok(cell.type in CELL_TYPES, `unknown cell type ${cell.type}`);
        assert.ok(cell.threshold === 1 || cell.threshold === 2);
        assert.equal(cell.hits, 0);
        assert.equal(cell.completed, false);
      }
    }
  });

  it("is not reproducible across calls (CSPRNG-driven)", () => {
    // Not a hard determinism guarantee — a statistical smoke test. 64 cells
    // per board, two boards, chance of an accidental identical layout is
    // astronomically small.
    const a = generateGrid();
    const b = generateGrid();
    assert.notDeepEqual(a, b, "two unseeded boards were identical — RNG looks broken");
  });
});

describe("generateGrid — seeded (Daily Challenge) boards", () => {
  it("same seed produces the exact same grid, cell for cell", () => {
    const seed = 123456789;
    const a = generateGrid(seed);
    const b = generateGrid(seed);
    assert.deepEqual(a, b);
  });

  it("different seeds produce different grids", () => {
    const a = generateGrid(1);
    const b = generateGrid(2);
    assert.notDeepEqual(a, b);
  });

  it("seeded cells are still valid (type/threshold in range)", () => {
    const grid = generateGrid(42);
    for (const cell of flatten(grid)) {
      assert.ok(cell.type in CELL_TYPES);
      assert.ok(cell.threshold === 1 || cell.threshold === 2);
    }
  });
});

describe("getDailySeed", () => {
  it("is deterministic for the same date", () => {
    assert.equal(getDailySeed("2026-08-13"), getDailySeed("2026-08-13"));
  });

  it("differs across different calendar dates", () => {
    assert.notEqual(getDailySeed("2026-08-13"), getDailySeed("2026-08-14"));
  });

  // A plain character-code sum is order-insensitive: "2026-08-13" and
  // "2026-08-31" contain the exact same digits, so a naive sum hashes them
  // identically and one day would silently reuse another day's board. This is
  // the concrete case that motivated FNV-1a over a sum.
  it("does not collide on digit-permutation dates (the sum-hash trap)", () => {
    assert.notEqual(getDailySeed("2026-08-13"), getDailySeed("2026-08-31"));
  });

  it("accepts a Date object equivalently to its ISO date string", () => {
    const d = new Date("2026-08-13T15:42:00Z");
    assert.equal(getDailySeed(d), getDailySeed("2026-08-13"));
  });

  it("feeding the same seed into generateGrid reproduces the same board", () => {
    const seedA = getDailySeed("2026-08-13");
    const seedB = getDailySeed("2026-08-14");
    assert.notEqual(seedA, seedB);
    assert.deepEqual(generateGrid(seedA), generateGrid(seedA));
    assert.notDeepEqual(generateGrid(seedA), generateGrid(seedB));
  });
});

describe("getDailySeed — DAILY_SEED_SALT (operator ruling 2026-08-13)", () => {
  const ORIGINAL_SALT = process.env.DAILY_SEED_SALT;

  function withSalt<T>(value: string | undefined, fn: () => T): T {
    if (value === undefined) delete process.env.DAILY_SEED_SALT;
    else process.env.DAILY_SEED_SALT = value;
    try {
      return fn();
    } finally {
      if (ORIGINAL_SALT === undefined) delete process.env.DAILY_SEED_SALT;
      else process.env.DAILY_SEED_SALT = ORIGINAL_SALT;
    }
  }

  it("same date + same salt is stable across calls", () => {
    withSalt("shh-its-a-secret", () => {
      const a = getDailySeed("2026-08-13");
      const b = getDailySeed("2026-08-13");
      assert.equal(a, b);
    });
  });

  it("different salts produce different seeds for the same date", () => {
    const a = withSalt("salt-one", () => getDailySeed("2026-08-13"));
    const b = withSalt("salt-two", () => getDailySeed("2026-08-13"));
    assert.notEqual(a, b, "two different salts must not collide");
  });

  it("a salted seed differs from the unsalted seed for the same date", () => {
    const unsalted = withSalt(undefined, () => getDailySeed("2026-08-13"));
    const salted = withSalt("some-secret", () => getDailySeed("2026-08-13"));
    assert.notEqual(unsalted, salted);
  });

  it("missing DAILY_SEED_SALT does not throw — falls back to the bare date hash", () => {
    withSalt(undefined, () => {
      assert.doesNotThrow(() => getDailySeed("2026-08-13"));
      // Unsalted output is exactly the pre-salt-feature hash (no separator byte
      // added when the salt is absent) — an unset env var changes nothing about
      // already-deployed unsalted behavior, only a set/rotated salt does.
      let hash = 0x811c9dc5;
      const dateStr = "2026-08-13";
      for (let i = 0; i < dateStr.length; i++) {
        hash ^= dateStr.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
      }
      assert.equal(getDailySeed("2026-08-13"), hash >>> 0);
    });
  });

  it("a salted seed still feeds generateGrid deterministically", () => {
    withSalt("determinism-check", () => {
      const seed = getDailySeed("2026-08-13");
      assert.deepEqual(generateGrid(seed), generateGrid(seed));
    });
  });
});
