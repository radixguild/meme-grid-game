import { getDb } from "../connection";
import { getLevel } from "../../game/levels";

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

/**
 * The ONLY columns that may leave this module. `routes/leaderboard.ts` serialises
 * whatever it gets straight to a public, unauthenticated JSON response, so this
 * list is the privacy boundary — not the `LeaderboardEntry` interface, which is
 * erased at runtime and stripped nothing.
 *
 * Never use `SELECT *` here. It shipped `pity_counter` (per-player randomness
 * state — a direct violation of the project's "never expose game randomness"
 * rule), `meme_balance`, `total_meme_deposited`/`_spent`, the streak columns and
 * `last_active` to every visitor. Adding a column to `players` must not silently
 * publish it; adding one here is a deliberate act.
 */
const PUBLIC_COLUMNS =
  "radix_address, display_name, level, xp, total_boards, best_score, total_rolls";

interface PlayerRow {
  radix_address: string;
  display_name: string | null;
  level: number;
  xp: number;
  total_boards: number;
  best_score: number;
  total_rolls: number;
}

function enrichEntry(row: PlayerRow): LeaderboardEntry {
  const lvl = getLevel(row.xp);
  return {
    radix_address: row.radix_address,
    display_name: row.display_name,
    level: row.level,
    xp: row.xp,
    total_boards: row.total_boards,
    best_score: row.best_score,
    total_rolls: row.total_rolls,
    level_name: lvl.name,
    level_emoji: lvl.emoji,
  };
}

function topBy(orderColumn: "xp" | "best_score" | "total_boards", limit: number): LeaderboardEntry[] {
  const rows = getDb()
    .prepare(`SELECT ${PUBLIC_COLUMNS} FROM players ORDER BY ${orderColumn} DESC LIMIT ?`)
    .all(limit) as PlayerRow[];
  return rows.map(enrichEntry);
}

export function getTopByXp(limit = 20): LeaderboardEntry[] {
  return topBy("xp", limit);
}

export function getTopByScore(limit = 20): LeaderboardEntry[] {
  return topBy("best_score", limit);
}

export function getTopByGrids(limit = 20): LeaderboardEntry[] {
  return topBy("total_boards", limit);
}

export function getPlayerRank(address: string): number {
  const row = getDb()
    .prepare(`
      SELECT COUNT(*) + 1 as rank FROM players
      WHERE xp > (SELECT xp FROM players WHERE radix_address = ?)
    `)
    .get(address) as any;
  return row?.rank ?? 0;
}

export function getTotalPlayers(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM players")
    .get() as any;
  return row?.count ?? 0;
}

export function getTotalBoards(): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM boards WHERE status = 'completed'")
    .get() as any;
  return row?.count ?? 0;
}
