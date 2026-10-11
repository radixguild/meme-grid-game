process.env.DB_PATH = ":memory:";

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { getDb, closeDb } from "../../connection";
import { getPlayerWithLevelInfo, getPityCounter } from "../players";
import { getLevel } from "../../../game/levels";
import { MAINNET_ACCOUNTS } from "../../../__tests__/fixtures/addresses";

const ADDR = MAINNET_ACCOUNTS[0];

/**
 * `getPlayerWithLevelInfo` is the player payload EVERY route ships — the game
 * state GET, board/new, roll, wild, and powerups/use all embed it. Unlike the
 * leaderboard, this one is the player's own row, so balances and streaks
 * legitimately belong in it.
 *
 * `pity_counter` does not. It is the randomness state that decides when the
 * next cell completion is forced, so a player who can read it knows exactly how
 * close a guaranteed hit is — the same class of leak `PUBLIC_COLUMNS` closes in
 * queries/leaderboard.ts, and the rule CLAUDE.md states outright: NEVER expose
 * game randomness to client.
 */
const FORBIDDEN = ["pity_counter"];

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
  // 42 rather than 0, so a leak is unmistakable instead of a plausible default.
  db.prepare(
    `INSERT INTO players (radix_address, display_name, level, xp, meme_balance,
       total_meme_deposited, total_meme_spent, total_boards, total_rolls, best_score,
       streak_current, streak_longest, streak_last_date, pity_counter,
       starting_balance_credited)
     VALUES (?, 'bigdev', 3, 4200, 987654, 111111, 222222, 7, 913, 555,
       4, 11, '2026-08-02', 42, 1)`,
  ).run(ADDR);
}

describe("player payload privacy boundary", () => {
  beforeEach(setupSchema);
  after(() => closeDb());

  it("getPlayerWithLevelInfo exposes no randomness state", () => {
    const player = getPlayerWithLevelInfo(ADDR)!;
    for (const col of FORBIDDEN) {
      assert.equal(
        col in (player as unknown as Record<string, unknown>),
        false,
        `player payload exposed "${col}" — it is the game's randomness state and ` +
          `this object is serialised into every game response`,
      );
    }
  });

  it("still returns the player's own data it is supposed to", () => {
    const player = getPlayerWithLevelInfo(ADDR)!;
    assert.equal(player.radix_address, ADDR);
    assert.equal(player.meme_balance, 987654);
    assert.equal(player.xp, 4200);
    assert.equal(player.streak_current, 4);
    // Derived from the level table, not hardcoded — the curve has been retuned
    // before (0–42,000 became 0–300,000) and a literal here would fail on the
    // next retune while testing nothing about the privacy boundary.
    assert.equal(player.level_name, getLevel(4200).name);
    assert.equal(typeof player.next_level_xp, "number");
  });

  it("getPityCounter still reads the real value for server-side roll logic", () => {
    assert.equal(getPityCounter(ADDR), 42);
  });

  it("getPityCounter returns 0 for an unknown address rather than throwing", () => {
    assert.equal(getPityCounter("account_rdx1_does_not_exist"), 0);
  });

  it("getPlayerWithLevelInfo returns null for an unknown address", () => {
    assert.equal(getPlayerWithLevelInfo("account_rdx1_does_not_exist"), null);
  });
});
