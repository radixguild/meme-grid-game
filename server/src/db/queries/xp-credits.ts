// XP credit ledger — the single entry point for crediting a player's XP.
//
// Mirrors roll-credits.ts (011) for the same reason it exists: more than one
// code path awards XP — the roll path (dice rolls, wilds, power-ups, all via
// updatePlayerAfterRoll in queries/players.ts) and achievement unlocks — and
// without one seam, "credit XP" turns into N call sites that can drift or
// double-fire. Route every XP mutation through `creditXp()`.
//
// Idempotency: unlike 011's `roll_credits` unique index (which is scoped only
// to (source, source_ref), NOT per player — see the migration comment in
// 012_xp_credits.sql for the live bug that causes), this table's index is
// scoped to (radix_address, source, source_ref). That is what makes
// achievement XP safe: the same achievement re-unlocking (it can't, the
// `achievements` table's own unique index on (radix_address, achievement_key)
// already prevents that — this is defense in depth) or a replayed award call
// for one address can never double-credit that address, while a different
// address earning the same achievement key is a completely independent grant.

import { getDb } from "../connection";
import { getLevel } from "../../game/levels";

/** Known sources. Kept open (plain string) so a new one needs no migration. */
export type XpSource =
  | "roll"
  | "achievement"
  | "guild_task"
  | (string & {});

export interface XpCreditInput {
  address: string;
  /** XP. Must be a positive integer — there is no XP debit path yet. */
  amount: number;
  source: XpSource;
  /** achievement_key | guild task id. When set, (address, source, sourceRef)
   *  can only ever be credited once — this is what makes replays safe. */
  sourceRef?: string | null;
  note?: string | null;
}

export interface XpCreditResult {
  /** false when this was a duplicate (address, source, sourceRef) — nothing was credited. */
  applied: boolean;
  /** false when the player row does not exist, so nothing could be credited. */
  playerExists: boolean;
  reason?: string;
  newXp?: number;
  newLevel?: number;
  leveledUp?: boolean;
}

/**
 * Credit XP and record the ledger row, atomically.
 *
 * Idempotent on (address, source, sourceRef) when sourceRef is provided: a
 * replayed achievement-unlock event or duplicate award call is a no-op, not a
 * second credit.
 *
 * Does not create the player row — crediting an address with no player row
 * surfaces as `playerExists: false` rather than silently doing nothing.
 */
export function creditXp(input: XpCreditInput): XpCreditResult {
  const { address, amount, source } = input;
  const sourceRef = input.sourceRef ?? null;
  const note = input.note ?? null;

  if (!Number.isInteger(amount) || amount <= 0) {
    return { applied: false, playerExists: false, reason: "amount must be a positive integer" };
  }
  if (!source) {
    return { applied: false, playerExists: false, reason: "source required" };
  }

  const db = getDb();
  const run = db.transaction((): XpCreditResult => {
    // Ledger row first — its uniqueness constraint IS the idempotency gate, so
    // it must land before xp moves. A duplicate throws and we credit nothing.
    try {
      db.prepare(
        `INSERT INTO xp_credits (radix_address, amount, source, source_ref, note)
         VALUES (?, ?, ?, ?, ?)`
      ).run(address, amount, source, sourceRef, note);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/UNIQUE constraint failed/i.test(msg)) {
        return { applied: false, playerExists: true, reason: "already credited" };
      }
      throw err;
    }

    const player = db
      .prepare("SELECT xp FROM players WHERE radix_address = ?")
      .get(address) as { xp: number } | undefined;
    if (!player) {
      // No player row — roll the ledger row back rather than leave a credit
      // that was recorded but never delivered.
      throw new NoSuchPlayerError(address);
    }

    const oldLevel = getLevel(player.xp);
    const newXp = player.xp + amount;
    const newLevel = getLevel(newXp);

    db.prepare(`UPDATE players SET xp = ?, level = ? WHERE radix_address = ?`)
      .run(newXp, newLevel.level, address);

    return {
      applied: true,
      playerExists: true,
      newXp,
      newLevel: newLevel.level,
      leveledUp: newLevel.level > oldLevel.level,
    };
  });

  try {
    return run();
  } catch (err) {
    if (err instanceof NoSuchPlayerError) {
      return { applied: false, playerExists: false, reason: "player not found" };
    }
    throw err;
  }
}

class NoSuchPlayerError extends Error {
  constructor(address: string) {
    super(`no player row for ${address}`);
    this.name = "NoSuchPlayerError";
  }
}

export interface XpCreditRow {
  amount: number;
  source: string;
  source_ref: string | null;
  note: string | null;
  created_at: number;
}

export function getXpCreditHistory(address: string, limit = 50): XpCreditRow[] {
  return getDb()
    .prepare(
      `SELECT amount, source, source_ref, note, created_at
         FROM xp_credits WHERE radix_address = ?
        ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(address, limit) as XpCreditRow[];
}

export function hasXpCredit(address: string, source: string, sourceRef: string): boolean {
  return (
    getDb()
      .prepare(
        "SELECT 1 FROM xp_credits WHERE radix_address = ? AND source = ? AND source_ref = ? LIMIT 1"
      )
      .get(address, source, sourceRef) !== undefined
  );
}
