// Roll credit ledger — the single entry point for giving a player rolls.
//
// Every route that grants MEME should go through `creditRolls` rather than calling
// `creditMemeBalance` directly, so the balance and the ledger can never diverge:
// both writes happen in one transaction.
//
// The `source` is how the guild link ships later without a redesign — a completed
// guild task is just `creditRolls({source: 'guild_task', sourceRef: taskId, …})`.

import { getDb } from "../connection";

/** Known sources. Kept open (plain string) so a new one needs no migration. */
export type CreditSource =
  | "free_start"
  | "purchase"
  | "guild_task"
  | "daily"
  | "promo"
  | "refund"
  | "level_up"
  | (string & {});

export interface CreditInput {
  address: string;
  /** MEME. Positive = credit. Rolls cost 1 MEME, so amount == number of rolls. */
  amount: number;
  source: CreditSource;
  /** tx hash | guild task id | promo code | check-in date. When set, the
   *  (address, source, sourceRef) triple can only ever be credited once — this
   *  is what makes replays safe. Scoped per player (migration 013) so a ref that
   *  is naturally shared across players, like daily.ts's check-in date, is an
   *  independent grant for each of them. */
  sourceRef?: string | null;
  note?: string | null;
}

export interface CreditResult {
  /** false when this was a duplicate (address, source, sourceRef) — nothing was credited. */
  applied: boolean;
  /** false when the player row does not exist, so nothing could be credited. */
  playerExists: boolean;
  reason?: string;
}

/**
 * Credit rolls (as MEME) and record the ledger row, atomically.
 *
 * Idempotent on (address, source, sourceRef) when sourceRef is provided: a
 * replayed guild task event or a re-submitted tx hash is a no-op for that
 * player, not a second credit.
 *
 * Does NOT create the player row. `creditMemeBalance` is a bare UPDATE, so
 * crediting an address that has never played silently did nothing while the API
 * reported success; here that surfaces as playerExists: false.
 */
export function creditRolls(input: CreditInput): CreditResult {
  const { address, amount, source } = input;
  const sourceRef = input.sourceRef ?? null;
  const note = input.note ?? null;

  if (!Number.isInteger(amount) || amount === 0) {
    return { applied: false, playerExists: false, reason: "amount must be a non-zero integer" };
  }
  if (!source) {
    return { applied: false, playerExists: false, reason: "source required" };
  }

  const db = getDb();
  const run = db.transaction((): CreditResult => {
    // Ledger row first — its uniqueness constraint IS the idempotency gate, so it
    // must land before the balance moves. A duplicate throws and we credit nothing.
    try {
      db.prepare(
        `INSERT INTO roll_credits (radix_address, amount, source, source_ref, note)
         VALUES (?, ?, ?, ?, ?)`
      ).run(address, amount, source, sourceRef, note);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/UNIQUE constraint failed/i.test(msg)) {
        return { applied: false, playerExists: true, reason: "already credited" };
      }
      throw err;
    }

    const res = db
      .prepare(
        `UPDATE players SET
           meme_balance = meme_balance + ?,
           total_meme_deposited = total_meme_deposited + ?
         WHERE radix_address = ?`
      )
      .run(amount, amount, address);

    if ((res.changes as number) === 0) {
      // No player row — roll the ledger row back rather than leave a credit that
      // was recorded but never delivered.
      throw new NoSuchPlayerError(address);
    }
    return { applied: true, playerExists: true };
  });

  try {
    return run();
  } catch (err) {
    // The throw above exists only to roll the transaction back; surface it as a
    // result so callers never have to reason about partial state.
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

/** Record a credit that already moved the balance by another path (back-fill/legacy). */
export function recordCreditOnly(input: CreditInput): boolean {
  try {
    getDb()
      .prepare(
        `INSERT INTO roll_credits (radix_address, amount, source, source_ref, note)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(input.address, input.amount, input.source, input.sourceRef ?? null, input.note ?? null);
    return true;
  } catch (err) {
    if (/UNIQUE constraint failed/i.test(err instanceof Error ? err.message : String(err))) return false;
    throw err;
  }
}

export interface CreditRow {
  amount: number;
  source: string;
  source_ref: string | null;
  note: string | null;
  created_at: number;
}

export function getCreditHistory(address: string, limit = 50): CreditRow[] {
  return getDb()
    .prepare(
      `SELECT amount, source, source_ref, note, created_at
         FROM roll_credits WHERE radix_address = ?
        ORDER BY created_at DESC, id DESC LIMIT ?`
    )
    .all(address, limit) as CreditRow[];
}

/** Where do rolls actually come from? Answers "revenue vs giveaway" in one query. */
export function getCreditTotalsBySource(): { source: string; credits: number; total: number }[] {
  return getDb()
    .prepare(
      `SELECT source, count(*) AS credits, sum(amount) AS total
         FROM roll_credits GROUP BY source ORDER BY total DESC`
    )
    .all() as { source: string; credits: number; total: number }[];
}

export function hasCredit(source: string, sourceRef: string): boolean {
  return (
    getDb()
      .prepare("SELECT 1 FROM roll_credits WHERE source = ? AND source_ref = ? LIMIT 1")
      .get(source, sourceRef) !== undefined
  );
}
