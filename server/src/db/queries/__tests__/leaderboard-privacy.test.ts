process.env.DB_PATH = ":memory:";

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { getDb, closeDb } from "../../connection";
import { getTopByXp, getTopByScore, getTopByGrids } from "../leaderboard";
import { MAINNET_ACCOUNTS } from "../../../__tests__/fixtures/addresses";

const ADDR = MAINNET_ACCOUNTS[0];

/**
 * Every column the public leaderboard is allowed to publish. `routes/leaderboard.ts`
 * serialises these entries straight into an unauthenticated JSON response, so anything
 * not on this list is a live data leak the moment it appears in the payload.
 */
const ALLOWED = new Set([
  "radix_address",
  "display_name",
  "level",
  "xp",
  "total_boards",
  "best_score",
  "total_rolls",
  "level_name",
  "level_emoji",
]);

/** Columns that exist on `players` and must never reach a caller. */
const FORBIDDEN = [
  "pity_counter",
  "meme_balance",
  "total_meme_deposited",
  "total_meme_spent",
  "streak_current",
  "streak_longest",
  "streak_last_date",
  "starting_balance_credited",
  "last_active",
  "created_at",
];

function setupSchema() {
  const db = getDb();
  db.exec("DROP TABLE IF EXISTS players");
  db.exec(`
    CREATE TABLE players (
      radix_address TEXT PRIMARY KEY,
      display_name TEXT,
      level INTEGER DEFAULT 1,
      xp INTEGER DEFAULT 0,
      meme_balance INTEGER DEFAULT 0,
      total_meme_deposited INTEGER DEFAULT 0,
      total_meme_spent INTEGER DEFAULT 0,
      total_boards INTEGER DEFAULT 0,
      total_rolls INTEGER DEFAULT 0,
      best_score INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      last_active INTEGER DEFAULT (strftime('%s','now')),
      streak_current INTEGER DEFAULT 0,
      streak_longest INTEGER DEFAULT 0,
      streak_last_date TEXT,
      pity_counter INTEGER DEFAULT 0,
      starting_balance_credited INTEGER NOT NULL DEFAULT 0
    );
  `);
  // Values chosen so a leak is unmistakable rather than a plausible zero.
  db.prepare(
    `INSERT INTO players (radix_address, display_name, level, xp, meme_balance,
       total_meme_deposited, total_meme_spent, total_boards, total_rolls, best_score,
       streak_current, streak_longest, streak_last_date, pity_counter,
       starting_balance_credited)
     VALUES (?, 'bigdev', 3, 4200, 987654, 111111, 222222, 7, 913, 555,
       4, 11, '2026-08-02', 42, 1)`,
  ).run(ADDR);
}

describe("leaderboard privacy boundary", () => {
  beforeEach(setupSchema);
  after(() => closeDb());

  for (const [name, fn] of [
    ["getTopByXp", getTopByXp],
    ["getTopByScore", getTopByScore],
    ["getTopByGrids", getTopByGrids],
  ] as const) {
    it(`${name} publishes only the allowed columns`, () => {
      const [entry] = fn(20);
      assert.ok(entry, "expected the seeded player back");

      const extra = Object.keys(entry).filter((k) => !ALLOWED.has(k));
      assert.deepEqual(
        extra,
        [],
        `${name} leaked non-public column(s): ${extra.join(", ")}`,
      );
    });

    it(`${name} exposes no private player state`, () => {
      const [entry] = fn(20);
      for (const col of FORBIDDEN) {
        assert.equal(
          col in (entry as unknown as Record<string, unknown>),
          false,
          `${name} exposed "${col}" — pity_counter is the game's randomness state and ` +
            `the balance columns are private; neither may reach a public response`,
        );
      }
    });
  }

  it("still returns the public fields it is supposed to", () => {
    const [entry] = getTopByXp(20);
    assert.equal(entry.radix_address, ADDR);
    assert.equal(entry.display_name, "bigdev");
    assert.equal(entry.xp, 4200);
    assert.equal(entry.total_boards, 7);
    assert.equal(entry.total_rolls, 913);
    assert.equal(entry.best_score, 555);
    // level_name/level_emoji are derived from xp, not read from the row.
    assert.equal(typeof entry.level_name, "string");
    assert.equal(typeof entry.level_emoji, "string");
  });
});
