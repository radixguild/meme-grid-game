import { getDb } from "../connection";
import type { Cell } from "../../game/grid";

export interface Board {
  id: number;
  radix_address: string;
  grid: Cell[][];
  score: number;
  rolls_used: number;
  extra_turns: number;
  wild_cards: number;
  status: string;
  cells_completed: number;
  lines_completed: number;
  patterns_completed: number;
  xray_remaining: number;
  magnet_remaining: number;
  is_daily: number;
  daily_date: string | null;
  created_at: number;
  completed_at: number | null;
}

function parseBoard(row: any): Board | null {
  if (!row) return null;
  try {
    return { ...row, grid: JSON.parse(row.grid) };
  } catch {
    throw new Error("Corrupted board data");
  }
}

export function getActiveBoard(address: string): Board | null {
  const row = getDb()
    .prepare("SELECT * FROM boards WHERE radix_address = ? AND status = 'active' ORDER BY id DESC LIMIT 1")
    .get(address);
  return parseBoard(row);
}

export function createBoard(address: string, grid: Cell[][]): Board {
  const db = getDb();
  const result = db
    .prepare("INSERT INTO boards (radix_address, grid) VALUES (?, ?)")
    .run(address, JSON.stringify(grid));
  return getActiveBoard(address)!;
}

/**
 * The daily board for `address` on `dailyDate` (YYYY-MM-DD), regardless of its
 * status (active/completed/abandoned) — unlike getActiveBoard, which only ever
 * finds it while still active. Used by the once-per-day-per-account guard to
 * decide "has this account already started today's Daily Challenge at all",
 * not just "is it still in progress".
 */
export function getDailyBoardForDate(address: string, dailyDate: string): Board | null {
  const row = getDb()
    .prepare(
      "SELECT * FROM boards WHERE radix_address = ? AND is_daily = 1 AND daily_date = ? ORDER BY id DESC LIMIT 1"
    )
    .get(address, dailyDate);
  return parseBoard(row);
}

export interface DailyBoardResult {
  board: Board;
  /** false when this call returned a pre-existing board instead of inserting. */
  created: boolean;
}

/**
 * Create today's daily board for `address`, enforced idempotent per
 * (radix_address, daily_date) by the migration-014 unique index
 * (`idx_boards_daily_once`) — see that migration for why this is a DB
 * constraint and not just a route-level check.
 *
 * Mirrors `queries/roll-credits.ts::creditRolls()`'s "insert first, catch the
 * UNIQUE violation, return the existing row" shape: the ledger/board's own
 * uniqueness constraint IS the idempotency gate. Callers that want to skip the
 * INSERT attempt entirely on the common (non-racing) path should check
 * `getDailyBoardForDate` first — this function is what stays correct even when
 * two requests for the same account+day race each other across processes,
 * where a plain check-then-insert would not be.
 */
export function createDailyBoardOnce(address: string, grid: Cell[][], dailyDate: string): DailyBoardResult {
  const db = getDb();
  try {
    db.prepare("INSERT INTO boards (radix_address, grid, is_daily, daily_date) VALUES (?, ?, 1, ?)").run(
      address,
      JSON.stringify(grid),
      dailyDate
    );
    return { board: getActiveBoard(address)!, created: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/UNIQUE constraint failed/i.test(msg)) {
      const existing = getDailyBoardForDate(address, dailyDate);
      if (existing) return { board: existing, created: false };
    }
    throw err;
  }
}

export function updateBoard(board: Board): void {
  getDb()
    .prepare(`
      UPDATE boards SET
        grid = ?,
        score = ?,
        rolls_used = ?,
        extra_turns = ?,
        wild_cards = ?,
        cells_completed = ?,
        status = ?,
        xray_remaining = ?,
        magnet_remaining = ?,
        completed_at = CASE WHEN ? IN ('completed','abandoned') THEN strftime('%s','now') ELSE completed_at END
      WHERE id = ?
    `)
    .run(
      JSON.stringify(board.grid),
      board.score,
      board.rolls_used,
      board.extra_turns,
      board.wild_cards,
      board.cells_completed,
      board.status,
      board.xray_remaining ?? 0,
      board.magnet_remaining ?? 0,
      board.status,
      board.id
    );
}

export function recordRoll(
  boardId: number,
  address: string,
  cellRow: number,
  cellCol: number,
  cellType: string,
  oldHits: number,
  newHits: number,
  completed: boolean,
  scoreChange: number,
  xpEarned: number,
  specialEffect: string | null,
  usedExtra: boolean
): void {
  getDb()
    .prepare(`
      INSERT INTO rolls (board_id, radix_address, cell_row, cell_col, cell_type, old_hits, new_hits, completed, score_change, xp_earned, special_effect, used_extra)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(boardId, address, cellRow, cellCol, cellType, oldHits, newHits, completed ? 1 : 0, scoreChange, xpEarned, specialEffect, usedExtra ? 1 : 0);
}

export function getBoardHistory(address: string, limit = 10): Board[] {
  const rows = getDb()
    .prepare("SELECT * FROM boards WHERE radix_address = ? ORDER BY id DESC LIMIT ?")
    .all(address, limit);
  return rows.map((r) => parseBoard(r)!);
}

export function countCompletedBoards(address: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) as count FROM boards WHERE radix_address = ? AND status = 'completed'")
    .get(address) as any;
  return row?.count ?? 0;
}
