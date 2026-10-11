export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";

export interface NftDef {
  key: string;
  name: string;
  emoji: string;
  rarity: Rarity;
  description: string;
  unlockCondition: string;
}

export const NFT_CATALOG: NftDef[] = [
  // Common (6)
  { key: "first_grid", name: "First Grid", emoji: "\ud83c\udf1f", rarity: "common", description: "Completed your first grid!", unlockCondition: "grids_completed >= 1" },
  { key: "five_grids", name: "Grid Veteran", emoji: "\ud83c\udfc5", rarity: "common", description: "Completed 5 grids", unlockCondition: "grids_completed >= 5" },
  { key: "rug_survivor", name: "Rug Survivor", emoji: "\ud83d\udee1\ufe0f", rarity: "common", description: "Survived 10 rug pulls", unlockCondition: "rug_pulls_hit >= 10" },
  { key: "extra_master", name: "Extra Turn Master", emoji: "\ud83c\udf81", rarity: "common", description: "Earned 20 extra turns", unlockCondition: "extra_turns_earned >= 20" },
  { key: "wild_user", name: "Wild User", emoji: "\ud83c\udccf", rarity: "common", description: "Used 10 wild cards", unlockCondition: "wild_cards_used >= 10" },
  { key: "dice_novice", name: "Dice Novice", emoji: "\ud83c\udfb2", rarity: "common", description: "Rolled 100 times", unlockCondition: "total_rolls >= 100" },

  // Uncommon (5)
  { key: "ten_grids", name: "Grid Master", emoji: "\ud83c\udfc6", rarity: "uncommon", description: "Completed 10 grids", unlockCondition: "grids_completed >= 10" },
  { key: "score_100", name: "Century Score", emoji: "\ud83d\udcaf", rarity: "uncommon", description: "Scored 100+ on a single board", unlockCondition: "best_score >= 100" },
  { key: "no_rug", name: "Clean Board", emoji: "\u2728", rarity: "uncommon", description: "Completed a board hitting 0 rug pulls", unlockCondition: "special:no_rug_board" },
  { key: "streak_7", name: "Week Warrior", emoji: "\ud83d\udd25", rarity: "uncommon", description: "7-day play streak", unlockCondition: "streak_days >= 7" },
  { key: "rolls_500", name: "Dice Addict", emoji: "\ud83c\udfb0", rarity: "uncommon", description: "500 total rolls", unlockCondition: "total_rolls >= 500" },

  // Rare (4)
  { key: "twentyfive_grids", name: "Grid Legend", emoji: "\ud83d\udc51", rarity: "rare", description: "Completed 25 grids", unlockCondition: "grids_completed >= 25" },
  { key: "score_200", name: "Double Century", emoji: "\ud83c\udf1f", rarity: "rare", description: "Scored 200+ on a single board", unlockCondition: "best_score >= 200" },
  { key: "perfect_board", name: "Perfect Board", emoji: "\ud83d\udc4c", rarity: "rare", description: "Completed a board with 0 rug pulls hit", unlockCondition: "special:perfect_board" },
  { key: "diamond_collector", name: "Diamond Collector", emoji: "\ud83d\udc8e", rarity: "rare", description: "Completed 10 diamond cells", unlockCondition: "diamonds_completed >= 10" },

  // Epic (4)
  { key: "fifty_grids", name: "Grid God", emoji: "\u26a1", rarity: "epic", description: "Completed 50 grids", unlockCondition: "grids_completed >= 50" },
  { key: "score_300", name: "Triple Century", emoji: "\ud83d\ude80", rarity: "epic", description: "Scored 300+ on a single board", unlockCondition: "best_score >= 300" },
  { key: "moon_shot", name: "Moon Shot", emoji: "\ud83c\udf19", rarity: "epic", description: "Completed a moon cell", unlockCondition: "moons_completed >= 1" },
  { key: "speed_runner", name: "Speed Runner", emoji: "\u23f1\ufe0f", rarity: "epic", description: "Completed a board in under 80 rolls", unlockCondition: "special:speed_run" },

  // Legendary (3)
  { key: "hundred_grids", name: "Grid Immortal", emoji: "\ud83c\udf0c", rarity: "legendary", description: "Completed 100 grids", unlockCondition: "grids_completed >= 100" },
  { key: "score_500", name: "High Roller", emoji: "\ud83d\udcb0", rarity: "legendary", description: "Scored 500+ on a single board", unlockCondition: "best_score >= 500" },
  { key: "full_collection", name: "Collector", emoji: "\ud83d\uddbc\ufe0f", rarity: "legendary", description: "Unlocked all other NFTs", unlockCondition: "special:full_collection" },

  // Mythic (1)
  { key: "meme_lord", name: "Meme Lord", emoji: "\ud83d\udc51", rarity: "mythic", description: "Reached level 10 \u2014 Meme Lord", unlockCondition: "level >= 10" },
];

export function getNftByKey(key: string): NftDef | undefined {
  return NFT_CATALOG.find((n) => n.key === key);
}

export function getCatalogByRarity(rarity: Rarity): NftDef[] {
  return NFT_CATALOG.filter((n) => n.rarity === rarity);
}

// ── Obtainability ───────────────────────────────────────────────────────────
//
// The catalog lists 23 NFTs but the award engine cannot currently grant all of
// them, so "collect all 23" is false advertising. Rather than hardcode a number
// that silently rots, obtainability is DERIVED from what
// `checkAndAwardAchievements()` (db/queries/achievements.ts) can actually
// evaluate. Implement a missing stat or a `special:` handler and the advertised
// count goes up on its own.
//
// Two ways an NFT is currently unreachable:
//   1. `special:` conditions — the award loop skips them outright ("checked
//      elsewhere"), and nothing anywhere else checks them.
//   2. Threshold conditions naming a stat the award loop is never given, e.g.
//      `rug_pulls_hit` — the lookup yields undefined and never fires.

/**
 * Stat fields the award engine is actually handed and can compare against.
 * Keep in sync with the `stats` parameter of `checkAndAwardAchievements()` —
 * a compile-time guard there fails the build if this list names a field that
 * does not exist on it.
 *
 * `board_id` is deliberately excluded: it is a row identifier, not a statistic,
 * and no unlock condition should ever threshold on it.
 */
export const EVALUABLE_STAT_FIELDS = [
  "grids_completed",
  "best_score",
  "total_rolls",
  "level",
  // Optional on the stats object, but passed at every call site today.
  "board_score",
] as const;

export type EvaluableStatField = (typeof EVALUABLE_STAT_FIELDS)[number];

const EVALUABLE_SET: ReadonlySet<string> = new Set(EVALUABLE_STAT_FIELDS);

/**
 * Parse a `"field >= value"` unlock condition. Returns null for anything the
 * award engine cannot evaluate, including `special:` conditions.
 *
 * Single source of truth for the condition grammar — the award engine and the
 * obtainability calculation MUST agree, or the advertised count drifts from
 * what players can really earn.
 */
export function parseThresholdCondition(
  condition: string
): { field: string; value: number } | null {
  if (condition.startsWith("special:")) return null;
  const match = condition.match(/^(\w+)\s*>=\s*(\d+)$/);
  if (!match) return null;
  return { field: match[1], value: parseInt(match[2], 10) };
}

/** True when a player can actually earn this NFT with the code as it stands. */
export function isObtainable(nft: NftDef): boolean {
  const parsed = parseThresholdCondition(nft.unlockCondition);
  return parsed !== null && EVALUABLE_SET.has(parsed.field);
}

/** NFTs a player can actually earn today. Use this for user-facing counts. */
export const OBTAINABLE_NFTS: NftDef[] = NFT_CATALOG.filter(isObtainable);

/**
 * The honest number to advertise. Currently 13 of 23 — never say "all 23"
 * until the remaining unlock conditions are implemented.
 */
export const OBTAINABLE_NFT_COUNT = OBTAINABLE_NFTS.length;

/** NFTs listed in the catalog that no player can currently unlock. */
export const UNOBTAINABLE_NFTS: NftDef[] = NFT_CATALOG.filter((n) => !isObtainable(n));
