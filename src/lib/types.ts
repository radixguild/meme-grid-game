export type CellType =
  | "normal"
  | "double_score"
  | "extra_turn"
  | "wild"
  | "rug_pull"
  | "pepe_bonus"
  | "otter"
  | "diamond"
  | "moon";

export interface Cell {
  type: CellType | null;
  hits: number;
  threshold: number | null;
  completed: boolean;
}

export interface Board {
  id: number;
  radix_address: string;
  grid: Cell[][];
  score: number;
  rolls_used: number;
  extra_turns: number;
  wild_cards: number;
  status: "active" | "completed" | "abandoned";
  cells_completed: number;
  lines_completed: number;
  patterns_completed: number;
  xray_remaining: number;
  magnet_remaining: number;
  created_at: number;
  completed_at: number | null;
}

export interface Player {
  radix_address: string;
  display_name: string | null;
  level: number;
  xp: number;
  meme_balance: number;
  total_meme_deposited: number;
  total_meme_spent: number;
  total_boards: number;
  total_rolls: number;
  best_score: number;
  streak_current: number;
  streak_longest: number;
  // No pity_counter. It is the server's randomness state and is stripped in
  // queries/players.ts getPlayerWithLevelInfo — declaring it here would invite
  // a component to read a field that no longer arrives.
  level_name: string;
  level_emoji: string;
  next_level_xp: number | null;
}

export interface DiceResult {
  value: number;
  label: string;
  bonusXp: number;
}

export interface LineBonus {
  type: "row" | "col" | "diagonal";
  index: number;
  reward: number;
  xp: number;
  label: string;
}

export interface PatternBonus {
  type: string;
  reward: number;
  xp: number;
  label: string;
  emoji: string;
}

export interface RollOutcome {
  dice: DiceResult;
  cellRow: number;
  cellCol: number;
  cellType: CellType;
  oldHits: number;
  newHits: number;
  cellCompleted: boolean;
  scoreChange: number;
  xpEarned: number;
  extraTurn: boolean;
  wildCardEarned: boolean;
  boardCompleted: boolean;
  message: string;
  lines: LineBonus[];
  patterns: PatternBonus[];
  comboMultiplier: number;
  lineBonusScore: number;
  lineBonusXp: number;
  nearMisses: Array<{ type: string; remaining: { row: number; col: number } }>;
  pityBonusXp: number;
}

export interface PowerUpDef {
  type: string;
  name: string;
  emoji: string;
  description: string;
  memeCost: number;
}

export interface NftDef {
  key: string;
  name: string;
  emoji: string;
  rarity: string;
  description: string;
  /**
   * False when the NFT's unlock condition is not implemented server-side, so no
   * player can currently earn it. Optional because an older server build omits
   * the field — treat `undefined` as obtainable rather than hiding the whole
   * catalog if the API is behind the frontend.
   */
  obtainable?: boolean;
}

export interface LeaderboardEntry {
  radix_address: string;
  display_name: string | null;
  level: number;
  level_name: string;
  level_emoji: string;
  xp: number;
  total_boards: number;
  best_score: number;
  total_rolls: number;
}
