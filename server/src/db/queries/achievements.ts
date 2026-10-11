import { getDb } from "../connection";
import {
  NFT_CATALOG,
  parseThresholdCondition,
  type EvaluableStatField,
  type NftDef,
} from "../../game/nfts";
import { queueNftMint } from "../../services/nft-minter";
import { creditXp } from "./xp-credits";

export interface Achievement {
  id: number;
  radix_address: string;
  achievement_key: string;
  achievement_name: string;
  board_id: number | null;
  score: number | null;
  xp_awarded: number;
  nft_key: string | null;
  created_at: number;
}

export function getPlayerAchievements(address: string): Achievement[] {
  return getDb()
    .prepare("SELECT * FROM achievements WHERE radix_address = ? ORDER BY created_at DESC")
    .all(address) as Achievement[];
}

export function hasAchievement(address: string, key: string): boolean {
  const row = getDb()
    .prepare("SELECT 1 FROM achievements WHERE radix_address = ? AND achievement_key = ?")
    .get(address, key);
  return !!row;
}

/**
 * Records the achievement row. Returns true only when this call actually
 * inserted it (a fresh unlock) rather than hitting the `INSERT OR IGNORE`
 * no-op path (already unlocked) — callers use this to decide whether to
 * credit the achievement's XP, mirroring how `unlockNft` below only queues a
 * mint on a genuine new unlock.
 */
export function recordAchievement(
  address: string,
  key: string,
  name: string,
  xpAwarded: number,
  boardId?: number,
  score?: number,
  nftKey?: string
): boolean {
  const result = getDb()
    .prepare(`
      INSERT OR IGNORE INTO achievements (radix_address, achievement_key, achievement_name, xp_awarded, board_id, score, nft_key)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)
    .run(address, key, name, xpAwarded, boardId ?? null, score ?? null, nftKey ?? null);
  return result.changes > 0;
}

export function getPlayerNfts(address: string) {
  return getDb()
    .prepare("SELECT * FROM nft_unlocks WHERE radix_address = ? ORDER BY created_at DESC")
    .all(address);
}

export function unlockNft(
  address: string,
  nft: NftDef,
  unlockedVia: string,
  boardId?: number
): void {
  const db = getDb();
  const result = db
    .prepare(`
      INSERT OR IGNORE INTO nft_unlocks (radix_address, nft_key, nft_name, rarity, unlocked_via, board_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    .run(address, nft.key, nft.name, nft.rarity, unlockedVia, boardId ?? null);

  // Queue for on-chain minting if this was a new unlock (not a duplicate)
  if (result.changes > 0) {
    const unlockId = result.lastInsertRowid as number;
    try {
      queueNftMint(unlockId, address, nft.key, nft.name, nft.rarity);
    } catch (err) {
      // Don't block gameplay if queue fails — mint can be retried later
      console.error(`[achievements] Failed to queue mint for ${nft.key}:`, err);
    }
  }
}

export interface AchievementStats {
  grids_completed: number;
  best_score: number;
  total_rolls: number;
  level: number;
  board_id?: number;
  board_score?: number;
}

export function checkAndAwardAchievements(
  address: string,
  stats: AchievementStats
): NftDef[] {
  const awarded: NftDef[] = [];

  // Explicit, exhaustively-typed projection of the stats an unlock condition may
  // threshold on. Typed as Record<EvaluableStatField, …> on purpose: adding a
  // field to EVALUABLE_STAT_FIELDS in game/nfts.ts fails the build until it is
  // wired up here, which is what stops OBTAINABLE_NFT_COUNT from advertising
  // NFTs the engine cannot actually award.
  const evaluable: Record<EvaluableStatField, number | undefined> = {
    grids_completed: stats.grids_completed,
    best_score: stats.best_score,
    total_rolls: stats.total_rolls,
    level: stats.level,
    board_score: stats.board_score,
  };

  for (const nft of NFT_CATALOG) {
    if (hasAchievement(address, nft.key)) continue;

    let earned = false;

    // Returns null for `special:` conditions (nothing implements them) and for
    // anything that isn't a "field >= value" threshold.
    const parsed = parseThresholdCondition(nft.unlockCondition);
    if (parsed && Object.prototype.hasOwnProperty.call(evaluable, parsed.field)) {
      const stat = evaluable[parsed.field as EvaluableStatField];
      if (typeof stat === "number" && stat >= parsed.value) earned = true;
    }

    if (earned) {
      const xpAward = { common: 50, uncommon: 100, rare: 250, epic: 500, legendary: 1000, mythic: 2500 }[nft.rarity] ?? 50;
      const isNewUnlock = recordAchievement(address, nft.key, nft.name, xpAward, stats.board_id, stats.board_score, nft.key);

      // Credit the XP through the seam only on a genuine new unlock — the
      // `hasAchievement` guard at the top of this loop already stops repeat
      // awards, and `isNewUnlock` is the atomic, race-safe confirmation (the
      // achievements table's own unique index on (radix_address,
      // achievement_key) is what actually enforces "once"). The ledger's
      // (address, source, sourceRef) uniqueness in creditXp() is defense in
      // depth on top of that, keyed on the achievement so a re-unlock or a
      // replayed call for this address can never double-credit — this is the
      // exact bug class ("XP faucet double-credit") this seam exists to
      // close.
      if (isNewUnlock) {
        creditXp({
          address,
          amount: xpAward,
          source: "achievement",
          sourceRef: nft.key,
          note: `achievement unlock: ${nft.name}`,
        });
      }
      unlockNft(address, nft, nft.key, stats.board_id);
      awarded.push(nft);
    }
  }

  return awarded;
}
