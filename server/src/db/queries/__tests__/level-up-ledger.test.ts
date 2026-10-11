process.env.DB_PATH = ":memory:";

/**
 * The level-up bonus is the last free-to-play ROLLS faucet.
 *
 * Streak ROLLS went to 0 and lucky drops moved behind board completion, which
 * leaves `LEVEL_UP_MEME` (levels 2-10, 2,725 ROLLS in total) as the only path
 * that hands out ROLLS for playing. It was applied as a bare
 * `meme_balance - ? + ?` inside the per-roll UPDATE, so it appeared in no ledger,
 * could not be attributed or audited, and had no idempotency guard: the only
 * thing stopping a level paying twice was the level comparison itself.
 *
 * These tests pin it to `creditRolls`, whose (address, source, source_ref) unique
 * index makes each level payable exactly once per player, permanently.
 */

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { getDb, closeDb } from "../../connection";
import { runMigrations } from "../../migrations/runner";
import { updatePlayerAfterRoll, getPlayer } from "../players";

const ADDR = "guest_levelledger";

function seedPlayer(address: string, memeBalance = 1000) {
  getDb()
    .prepare("INSERT INTO players (radix_address, meme_balance) VALUES (?, ?)")
    .run(address, memeBalance);
}

function ledgerRows(address: string) {
  return getDb()
    .prepare(
      "SELECT amount, source, source_ref FROM roll_credits WHERE radix_address = ? AND source = 'level_up' ORDER BY id"
    )
    .all(address) as Array<{ amount: number; source: string; source_ref: string }>;
}

describe("the level-up ROLLS bonus goes through the roll_credits ledger", () => {
  before(() => {
    runMigrations(getDb());
  });

  beforeEach(() => {
    const db = getDb();
    db.pragma("foreign_keys = OFF");
    for (const t of ["rolls", "roll_credits", "xp_credits", "boards", "players"]) {
      try {
        db.exec(`DELETE FROM ${t};`);
      } catch {
        // best-effort wipe
      }
    }
    db.pragma("foreign_keys = ON");
  });

  after(() => {
    closeDb();
  });

  it("crossing level 2 writes a ledger row, not just a balance bump", () => {
    seedPlayer(ADDR);
    // Level 2 is 2,000 XP (game/levels.ts).
    updatePlayerAfterRoll(ADDR, 2000, 1);

    const rows = ledgerRows(ADDR);
    assert.equal(rows.length, 1, "the grant must be recorded, not applied invisibly");
    assert.equal(rows[0].amount, 25, "level 2 pays 25 ROLLS (LEVEL_UP_MEME)");
    assert.equal(rows[0].source_ref, "level:2", "the level is the idempotency key");
  });

  it("the balance still moves by the same amount as before", () => {
    seedPlayer(ADDR, 1000);
    updatePlayerAfterRoll(ADDR, 2000, 1);

    const player = getPlayer(ADDR)!;
    // -1 spent on the roll, +25 for level 2.
    assert.equal(player.meme_balance, 1024, "routing through the ledger must not change the payout");
  });

  it("a level pays once per player, even if it is somehow crossed again", () => {
    seedPlayer(ADDR);
    updatePlayerAfterRoll(ADDR, 2000, 1);
    const afterFirst = getPlayer(ADDR)!.meme_balance;

    // Force the player back below level 2 and cross it a second time. Before the
    // ledger this paid again; the unique index now refuses silently.
    getDb().prepare("UPDATE players SET xp = 0, level = 1 WHERE radix_address = ?").run(ADDR);
    getDb().prepare("DELETE FROM xp_credits WHERE radix_address = ?").run(ADDR);
    updatePlayerAfterRoll(ADDR, 2000, 1);

    assert.equal(ledgerRows(ADDR).length, 1, "level 2 must never be credited twice");
    assert.equal(
      getPlayer(ADDR)!.meme_balance,
      afterFirst - 1,
      "the second crossing should cost a roll and pay nothing"
    );
  });

  it("a roll that crosses no level writes no ledger row", () => {
    seedPlayer(ADDR);
    updatePlayerAfterRoll(ADDR, 10, 1);

    assert.equal(ledgerRows(ADDR).length, 0, "only an actual level-up is a grant");
    assert.equal(getPlayer(ADDR)!.meme_balance, 999);
  });

  it("each level has its own ref, so later levels still pay", () => {
    seedPlayer(ADDR);
    updatePlayerAfterRoll(ADDR, 2000, 1); // level 2
    updatePlayerAfterRoll(ADDR, 4000, 1); // level 3 at 6,000 XP

    const rows = ledgerRows(ADDR);
    assert.deepEqual(
      rows.map((r) => r.source_ref),
      ["level:2", "level:3"],
      "the guard is per level, not per player"
    );
    assert.deepEqual(rows.map((r) => r.amount), [25, 50]);
  });
});
