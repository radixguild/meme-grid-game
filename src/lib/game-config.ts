import type { CellType } from "./types";

export interface CellConfig {
  emoji: string;
  label: string;
  color: string;
  glowColor: string;
  /** Subtle per-type tint behind the glyph \u2014 gives each cell a colour identity. */
  tint: string;
  /** Optional full-bleed cell artwork (fills the square instead of the emoji). */
  image?: string;
}

export const CELL_CONFIG: Record<CellType, CellConfig> = {
  normal: { emoji: "\u2b1c", label: "Normal", color: "text-gray-300", glowColor: "shadow-gray-500/30", tint: "bg-gray-500/10" },
  double_score: { emoji: "\ud83d\ude80", label: "Double", color: "text-yellow-400", glowColor: "shadow-yellow-500/40", tint: "bg-yellow-500/10" },
  extra_turn: { emoji: "\ud83c\udf81", label: "Extra", color: "text-cyan-400", glowColor: "shadow-cyan-500/40", tint: "bg-cyan-500/10" },
  wild: { emoji: "\ud83c\udccf", label: "Wild", color: "text-purple-400", glowColor: "shadow-purple-500/40", tint: "bg-purple-500/10" },
  rug_pull: { emoji: "\ud83d\udc80", label: "Rug Pull", color: "text-red-400", glowColor: "shadow-red-500/40", tint: "bg-red-500/10" },
  pepe_bonus: { emoji: "\ud83d\udc38", label: "Pepe", color: "text-green-400", glowColor: "shadow-green-500/40", tint: "bg-green-500/10" },
  otter: { emoji: "\ud83e\udda6", label: "Otter", color: "text-purple-300", glowColor: "shadow-purple-500/50", tint: "bg-purple-500/15", image: "/cells/otter.svg" },
  diamond: { emoji: "\ud83d\udc8e", label: "Diamond", color: "text-white", glowColor: "shadow-white/40", tint: "bg-cyan-300/10" },
  moon: { emoji: "\ud83c\udf19", label: "Moon", color: "text-indigo-300", glowColor: "shadow-indigo-500/40", tint: "bg-indigo-500/15" },
};

/**
 * How many distinct cell types the grid can produce.
 *
 * Derived, not written down. Three places said "8 cell types" (the meta
 * description, the Twitter card, and the landing-page feature card) while
 * `server/src/game/grid.ts` has always had NINE — a player only had to count the
 * legend on /how-to-play to catch it. Import this instead of typing a number.
 */
export const CELL_TYPE_COUNT = Object.keys(CELL_CONFIG).length;

export const LEVELS = [
  { level: 1, name: "Normie", emoji: "\ud83d\udc64", xp: 0 },
  { level: 2, name: "Lurker", emoji: "\ud83d\udc40", xp: 2000 },
  { level: 3, name: "Degen", emoji: "\ud83c\udfb0", xp: 6000 },
  { level: 4, name: "Diamond Hands", emoji: "\ud83d\udc8e", xp: 15000 },
  { level: 5, name: "Whale", emoji: "\ud83d\udc33", xp: 30000 },
  { level: 6, name: "Chad", emoji: "\ud83d\uddff", xp: 55000 },
  { level: 7, name: "Gigabrain", emoji: "\ud83e\udde0", xp: 90000 },
  { level: 8, name: "Based", emoji: "\ud83c\udfe2", xp: 140000 },
  { level: 9, name: "Sigma", emoji: "\u26a1", xp: 210000 },
  { level: 10, name: "Meme Lord", emoji: "\ud83d\udc51", xp: 300000 },
];

export const DICE_FACES = ["\u2680", "\u2681", "\u2682", "\u2683", "\u2684", "\u2685"];

export const POWER_UPS = [
  { type: "row_bomb", name: "Row Bomb", emoji: "\ud83d\udca3", description: "Complete a full row instantly", cost: 30 },
  { type: "reroll", name: "Re-Roll", emoji: "\ud83d\udd04", description: "Re-roll — hit a new random cell", cost: 5 },
  { type: "swap", name: "Cell Swap", emoji: "\ud83d\udd00", description: "Change a rug pull to normal", cost: 15 },
  { type: "magnet", name: "Magnet", emoji: "\ud83e\uddf2", description: "Next 3 rolls target near-complete cells", cost: 20 },
  { type: "x_ray", name: "X-Ray", emoji: "\ud83d\udd0d", description: "Reveal all cell types for 5 rolls", cost: 10 },
];

// Mirrors STREAK_REWARDS in server/src/game/streaks.ts. ROLLS are 0 at EVERY tier
// there, deliberately — a daily check-in is not work, and paying ROLLS for one was
// the farm vector. Advertising "10 ROLLS" here for a server that pays none is the
// worst kind of stale copy: the player can see it did not happen.
//
// Tiers are 1/2/3/5/7/14/30 server-side; the four shown here are the ones with
// something to announce.
export const STREAK_MILESTONES = [
  { days: 3, label: "3-Day Streak", reward: "+10% XP" },
  { days: 5, label: "5-Day Streak", reward: "+15% XP + Re-Roll" },
  { days: 7, label: "Week Warrior", reward: "+20% XP + X-Ray" },
  { days: 14, label: "Two Weeks", reward: "+30% XP + Magnet" },
  { days: 30, label: "Monthly Legend", reward: "+50% XP + Row Bomb" },
];
