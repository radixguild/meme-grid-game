process.env.DB_PATH = ":memory:";

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { getDb, closeDb } from "../../connection";
import { checkAndAwardAchievements, getPlayerNfts } from "../achievements";
import { getXpCreditHistory } from "../xp-credits";
import { OBTAINABLE_NFTS, UNOBTAINABLE_NFTS } from "../../../game/nfts";

// Proves the advertised count is the REAL count: drive the award engine with
// stats far above every threshold in the catalog and assert that exactly the
// NFTs `nfts.ts` calls obtainable actually land in `nft_unlocks`. If these ever
// disagree, either the marketing copy or the engine is lying.
//
// A guest address is used deliberately: `queueNftMint` short-circuits for
// guests, so this exercises award logic without touching the mint path.
const ADDR = "guest_test_awards";

function setupSchema() {
  const db = getDb();
  db.exec("DROP TABLE IF EXISTS nft_mint_queue");
  db.exec("DROP TABLE IF EXISTS nft_unlocks");
  db.exec("DROP TABLE IF EXISTS achievements");
  db.exec("DROP TABLE IF EXISTS xp_credits");
  db.exec("DROP TABLE IF EXISTS players");
  db.exec(`CREATE TABLE players (radix_address TEXT PRIMARY KEY, xp INTEGER DEFAULT 0, level INTEGER DEFAULT 1);`);
  db.exec(`
    CREATE TABLE xp_credits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      radix_address TEXT NOT NULL,
      amount INTEGER NOT NULL,
      source TEXT NOT NULL,
      source_ref TEXT,
      note TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      CHECK (length(source) > 0),
      CHECK (amount > 0)
    );
    CREATE UNIQUE INDEX idx_xp_credits_addr_source_ref_unique
      ON xp_credits(radix_address, source, source_ref) WHERE source_ref IS NOT NULL;
  `);
  db.exec(`
    CREATE TABLE achievements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      radix_address TEXT NOT NULL,
      achievement_key TEXT NOT NULL,
      achievement_name TEXT NOT NULL,
      board_id INTEGER,
      score INTEGER,
      xp_awarded INTEGER DEFAULT 0,
      nft_key TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE UNIQUE INDEX idx_achievements_unique ON achievements(radix_address, achievement_key);
  `);
  db.exec(`
    CREATE TABLE nft_unlocks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      radix_address TEXT NOT NULL,
      nft_key TEXT NOT NULL,
      nft_name TEXT NOT NULL,
      rarity TEXT NOT NULL CHECK(rarity IN ('common','uncommon','rare','epic','legendary','mythic')),
      unlocked_via TEXT NOT NULL,
      board_id INTEGER,
      minted_on_chain INTEGER DEFAULT 0,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE UNIQUE INDEX idx_nft_unique ON nft_unlocks(radix_address, nft_key);
  `);
  db.exec(`
    CREATE TABLE nft_mint_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nft_unlock_id INTEGER NOT NULL,
      radix_address TEXT NOT NULL,
      nft_key TEXT NOT NULL,
      nft_name TEXT NOT NULL,
      rarity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
  `);
  db.prepare("INSERT INTO players (radix_address) VALUES (?)").run(ADDR);
}

// Comfortably past every threshold in NFT_CATALOG (max is 500).
const MAXED = {
  grids_completed: 1000,
  best_score: 1000,
  total_rolls: 1000,
  level: 10,
  board_id: 1,
  board_score: 1000,
};

describe("checkAndAwardAchievements", () => {
  beforeEach(setupSchema);
  after(() => closeDb());

  it("awards exactly the NFTs nfts.ts advertises as obtainable", () => {
    const awarded = checkAndAwardAchievements(ADDR, MAXED);
    assert.deepEqual(
      awarded.map((n) => n.key).sort(),
      OBTAINABLE_NFTS.map((n) => n.key).sort()
    );
    assert.equal(awarded.length, 13);
  });

  it("awards none of the 10 unreachable NFTs even at maxed stats", () => {
    checkAndAwardAchievements(ADDR, MAXED);
    const unlockedKeys = new Set(
      (getPlayerNfts(ADDR) as Array<{ nft_key: string }>).map((r) => r.nft_key)
    );
    for (const nft of UNOBTAINABLE_NFTS) {
      assert.ok(
        !unlockedKeys.has(nft.key),
        `${nft.key} is advertised as unobtainable but was awarded`
      );
    }
    assert.equal(unlockedKeys.size, 13);
  });

  it("persists the unlocks it reports", () => {
    const awarded = checkAndAwardAchievements(ADDR, MAXED);
    assert.equal((getPlayerNfts(ADDR) as unknown[]).length, awarded.length);
  });

  it("is idempotent — a second call at the same stats awards nothing", () => {
    assert.equal(checkAndAwardAchievements(ADDR, MAXED).length, 13);
    assert.equal(checkAndAwardAchievements(ADDR, MAXED).length, 0);
    assert.equal((getPlayerNfts(ADDR) as unknown[]).length, 13);
  });

  it("respects thresholds — a first-time player only earns the entry tier", () => {
    const awarded = checkAndAwardAchievements(ADDR, {
      grids_completed: 1,
      best_score: 10,
      total_rolls: 12,
      level: 1,
      board_id: 1,
      board_score: 10,
    });
    assert.deepEqual(awarded.map((n) => n.key), ["first_grid"]);
  });

  it("ignores conditions whose stat the engine is never given", () => {
    // `rug_survivor` needs rug_pulls_hit >= 10. Passing it does NOT unlock the
    // NFT, because the engine only reads its declared stat fields — this is the
    // concrete reason 10 NFTs are unreachable.
    const withExtra = { ...MAXED, rug_pulls_hit: 9999 } as typeof MAXED;
    const awarded = checkAndAwardAchievements(ADDR, withExtra);
    assert.ok(!awarded.some((n) => n.key === "rug_survivor"));
    assert.equal(awarded.length, 13);
  });

  // PROJECT-STATE.md open item 5: xp_awarded was recorded on the achievement
  // row but nothing ever credited it into players.xp. These pin the fix.
  it("credits achievement XP into players.xp exactly once per unlock", () => {
    const awarded = checkAndAwardAchievements(ADDR, MAXED);
    const history = getXpCreditHistory(ADDR).filter((r) => r.source === "achievement");

    assert.equal(history.length, awarded.length, "one xp_credits row per unlocked achievement");
    assert.deepEqual(
      history.map((r) => r.source_ref).sort(),
      awarded.map((n) => n.key).sort()
    );

    const totalXp = history.reduce((sum, r) => sum + r.amount, 0);
    const player = getDb().prepare("SELECT xp FROM players WHERE radix_address = ?").get(ADDR) as { xp: number };
    assert.ok(totalXp > 0);
    assert.equal(player.xp, totalXp);
  });

  // The exact bug class flagged for this feature: "the guild stack had
  // exactly this bug class, XP faucet double-credit." A re-unlock attempt or
  // a replayed award call must never mint the achievement's XP twice.
  it("does not double-credit XP on a repeat call at the same stats", () => {
    checkAndAwardAchievements(ADDR, MAXED);
    const afterFirst = (getDb().prepare("SELECT xp FROM players WHERE radix_address = ?").get(ADDR) as { xp: number }).xp;

    const second = checkAndAwardAchievements(ADDR, MAXED);
    assert.equal(second.length, 0, "no new unlocks on replay");

    const afterSecond = (getDb().prepare("SELECT xp FROM players WHERE radix_address = ?").get(ADDR) as { xp: number }).xp;
    assert.equal(afterSecond, afterFirst, "xp must not move on a replay");
  });
});
