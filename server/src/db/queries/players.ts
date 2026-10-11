import { getDb } from "../connection";
import { getLevel, getNextLevelXp } from "../../game/levels";
import { creditXp } from "./xp-credits";
import { creditRolls } from "./roll-credits";

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
  streak_last_date: string | null;
  pity_counter: number;
  starting_balance_credited: number;
  created_at: number;
  last_active: number;
}

export function getPlayer(address: string): Player | null {
  return getDb().prepare("SELECT * FROM players WHERE radix_address = ?").get(address) as Player | null;
}

export function getOrCreatePlayer(address: string): Player {
  const existing = getPlayer(address);
  if (existing) return existing;

  getDb()
    .prepare("INSERT INTO players (radix_address) VALUES (?)")
    .run(address);
  return getPlayer(address)!;
}

export function updatePlayerAfterRoll(
  address: string,
  xpGained: number,
  memeSpent: number
): Player {
  const db = getDb();
  const player = getPlayer(address)!;
  const oldLevel = getLevel(player.xp);

  // XP is credited through the seam (queries/xp-credits.ts) so every XP
  // mutation — roll-path or achievement — flows through the same single,
  // ledgered function. `xpGained` is 0 for calls that only spend MEME (e.g.
  // board/new, power-up activation), and creditXp() requires amount > 0, so
  // skip it rather than treat 0 as a no-op credit; newLevel then stays at the
  // player's current level, matching the previous behavior exactly.
  let newLevel = oldLevel;
  if (xpGained > 0) {
    const xpResult = creditXp({ address, amount: xpGained, source: "roll" });
    if (xpResult.applied && xpResult.newLevel !== undefined) {
      newLevel = getLevel(xpResult.newXp!);
    }
  }

  // Level up bonus: earn ROLLS on each level up.
  //
  // This is the only free-to-play ROLLS faucet left after streaks were zeroed —
  // 2,725 across levels 2-10 — so it goes through the ledger like every other
  // grant. It used to be folded into the balance UPDATE below as a bare
  // `meme_balance - ? + ?`, which meant it appeared in no ledger, could not be
  // audited or attributed, and had no idempotency guard: nothing but the level
  // comparison stopped a level from paying twice.
  //
  // `sourceRef` is the level itself, so the (address, source, source_ref) unique
  // index makes each level payable exactly once per player, permanently — even if
  // a level is somehow re-crossed after an XP correction or a replayed request.
  const LEVEL_UP_MEME: Record<number, number> = {
    2: 25,   // Lurker
    3: 50,   // Degen
    4: 100,  // Diamond Hands
    5: 150,  // Whale
    6: 200,  // Chad
    7: 300,  // Gigabrain
    8: 400,  // Based
    9: 500,  // Sigma
    10: 1000, // Meme Lord
  };

  let levelUpBonus = 0;
  if (newLevel.level > oldLevel.level) {
    levelUpBonus = LEVEL_UP_MEME[newLevel.level] || 0;
  }

  db.prepare(`
    UPDATE players SET
      meme_balance = meme_balance - ?,
      total_meme_spent = total_meme_spent + ?,
      total_rolls = total_rolls + 1,
      last_active = strftime('%s','now')
    WHERE radix_address = ?
  `).run(memeSpent, memeSpent, address);

  // After the debit, so a level-up paid on the roll that spent the last ROLL
  // still lands. creditRolls opens a savepoint inside whichever transaction the
  // caller already holds; every call site here is inside one.
  if (levelUpBonus > 0) {
    creditRolls({
      address,
      amount: levelUpBonus,
      source: "level_up",
      sourceRef: `level:${newLevel.level}`,
      note: `Reached level ${newLevel.level} (${newLevel.name})`,
    });
  }

  return getPlayer(address)!;
}

export function updatePlayerBoardComplete(address: string, score: number): void {
  const db = getDb();
  db.prepare(`
    UPDATE players SET
      total_boards = total_boards + 1,
      best_score = MAX(best_score, ?),
      last_active = strftime('%s','now')
    WHERE radix_address = ?
  `).run(score, address);
}

export function creditMemeBalance(address: string, amount: number): void {
  getDb().prepare(`
    UPDATE players SET
      meme_balance = meme_balance + ?,
      total_meme_deposited = total_meme_deposited + ?
    WHERE radix_address = ?
  `).run(amount, amount, address);
}

// Credits the free starting balance exactly once per address.
// Uses starting_balance_credited flag for DB-level idempotency —
// safe to call on every GET; repeated calls are no-ops.
export function creditStartingBalanceOnce(address: string, amount: number): boolean {
  const result = getDb().prepare(`
    UPDATE players SET
      meme_balance = meme_balance + ?,
      total_meme_deposited = total_meme_deposited + ?,
      starting_balance_credited = 1
    WHERE radix_address = ? AND starting_balance_credited = 0
  `).run(amount, amount, address);
  return (result.changes as number) > 0;
}

/// The player's own pity counter, for server-side roll logic only.
///
/// Deliberately its own query rather than a field off `getPlayerWithLevelInfo`:
/// that function is the RESPONSE shape and must not carry randomness state, so
/// anything server-side that needs the real value asks for it explicitly.
export function getPityCounter(address: string): number {
  const row = getDb()
    .prepare("SELECT pity_counter FROM players WHERE radix_address = ?")
    .get(address) as { pity_counter: number } | undefined;
  return row?.pity_counter ?? 0;
}

/// The player payload every route ships to the client.
///
/// `pity_counter` is stripped here and nowhere else. It is the game's randomness
/// state — it decides when the next cell completion is forced — so a player who
/// can read it knows exactly how close a guaranteed hit is, which is the same
/// class of leak `PUBLIC_COLUMNS` closes in queries/leaderboard.ts and the same
/// rule CLAUDE.md states: NEVER expose game randomness to client.
///
/// Server-side callers that need the real value use `getPityCounter()`.
export function getPlayerWithLevelInfo(address: string) {
  const player = getPlayer(address);
  if (!player) return null;
  const level = getLevel(player.xp);
  const nextXp = getNextLevelXp(player.xp);
  const { pity_counter: _pity, ...publicPlayer } = player;
  return {
    ...publicPlayer,
    level_name: level.name,
    level_emoji: level.emoji,
    next_level_xp: nextXp,
  };
}
