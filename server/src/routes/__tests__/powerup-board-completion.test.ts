process.env.DB_PATH = ":memory:";

/**
 * A board finished BY A POWER-UP must end up in exactly the state a board
 * finished by a roll ends up in.
 *
 * It did not. `routes/powerups.ts` only ever set `status: "completed"` inside the
 * `reroll` case, because that case had a `processRoll` outcome to copy the flag
 * from. Row Bomb completes cells directly and never asked the question — so a
 * Row Bomb that landed the last cells left the board at `status: "active"` with a
 * full grid, which every other part of the server treats as impossible:
 *
 *   - no lucky drops, no achievements, no milestone, no board-completion stats;
 *   - `getActiveBoard` keeps returning it forever;
 *   - and `processRoll` throws "Board is already completed" on a full grid, so
 *     the next roll 500s. The board can be neither finished nor played.
 *
 * The only escape was abandoning it, unrefunded. These tests pin the fix.
 */

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { getDb, closeDb } from "../../db/connection";
import { runMigrations } from "../../db/migrations/runner";
import { createApp } from "../../app";
import { generateGrid, GRID_SIZE, type Cell } from "../../game/grid";
import { addPowerUp } from "../../db/queries/powerups";

const ADDR = "guest_powerupfin";

let baseUrl = "";
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;

function fundPlayer(address: string, memeBalance = 1000) {
  getDb()
    .prepare("INSERT INTO players (radix_address, meme_balance) VALUES (?, ?)")
    .run(address, memeBalance);
}

/**
 * Insert a board whose only incomplete cells are in `incompleteRow`.
 *
 * Row Bomb clears a RANDOM row, so a board with exactly one row left is the only
 * shape where "the bomb finishes the board" is deterministic.
 */
function seedBoardWithOneRowLeft(address: string, incompleteRow: number): number {
  const grid: Cell[][] = generateGrid();
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      const cell = grid[r][c];
      if (r === incompleteRow) {
        cell.hits = 0;
        cell.completed = false;
      } else {
        cell.hits = cell.threshold;
        cell.completed = true;
      }
    }
  }
  const info = getDb()
    .prepare(
      `INSERT INTO boards (radix_address, grid, status, cells_completed, rolls_used)
       VALUES (?, ?, 'active', ?, ?)`
    )
    .run(address, JSON.stringify(grid), GRID_SIZE * (GRID_SIZE - 1), 90);
  return info.lastInsertRowid as number;
}

function boardRow(id: number) {
  return getDb()
    .prepare("SELECT status, cells_completed, completed_at FROM boards WHERE id = ?")
    .get(id) as { status: string; cells_completed: number; completed_at: number | null };
}

async function useRowBomb(address: string) {
  const res = await fetch(`${baseUrl}/api/powerups/${address}/use`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "row_bomb" }),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe("POST /api/powerups/:address/use — a board finished by a power-up", () => {
  before(async () => {
    runMigrations(getDb());
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  beforeEach(() => {
    // A completed board writes to rolls, achievements, roll_credits and the
    // reward tables, all of which have FKs back to boards/players — so a
    // boards-then-players wipe (which is enough for tests that never finish a
    // board) trips SQLITE_CONSTRAINT_FOREIGNKEY here from the second test on.
    // Drop the constraint for the wipe rather than trying to keep a delete order
    // in sync with future migrations.
    const db = getDb();
    db.pragma("foreign_keys = OFF");
    for (const t of [
      "rolls",
      "roll_credits",
      "xp_credits",
      "player_achievements",
      "powerups",
      "boards",
      "players",
    ]) {
      try {
        db.exec(`DELETE FROM ${t};`);
      } catch {
        // Table may not exist in every migration state; the wipe is best-effort.
      }
    }
    db.pragma("foreign_keys = ON");
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDb();
  });

  it("a Row Bomb that lands the final cells marks the board completed", async () => {
    fundPlayer(ADDR);
    const boardId = seedBoardWithOneRowLeft(ADDR, 3);
    addPowerUp(ADDR, "row_bomb");

    const r = await useRowBomb(ADDR);
    assert.equal(r.status, 200, JSON.stringify(r.body));

    const row = boardRow(boardId);
    assert.equal(
      row.status,
      "completed",
      "a full grid left as 'active' is the soft-lock: every later roll throws"
    );
    assert.equal(row.cells_completed, GRID_SIZE * GRID_SIZE);
    assert.ok(row.completed_at, "completed_at must be stamped, as it is for a rolled finish");
  });

  it("the finished board stops being the player's ACTIVE board", async () => {
    fundPlayer(ADDR);
    seedBoardWithOneRowLeft(ADDR, 0);
    addPowerUp(ADDR, "row_bomb");

    await useRowBomb(ADDR);

    const active = getDb()
      .prepare("SELECT id FROM boards WHERE radix_address = ? AND status = 'active'")
      .all(ADDR);
    assert.equal(active.length, 0, "a completed board must not still be returned as active");
  });

  it("the player can start a new board afterwards — this is the soft-lock", async () => {
    fundPlayer(ADDR);
    seedBoardWithOneRowLeft(ADDR, 5);
    addPowerUp(ADDR, "row_bomb");
    await useRowBomb(ADDR);

    // The real user-facing symptom, and what makes this a LOCK rather than just a
    // missed payout. The old board stayed `active` on a full grid, so rolling it
    // threw "Board is already completed" AND starting a fresh one was refused
    // because an active board already existed. Neither forward nor back; the only
    // exit was abandoning the board, unrefunded.
    const res = await fetch(`${baseUrl}/api/game/${ADDR}/board/new`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await res.text();
    assert.equal(
      res.status,
      200,
      `a finished board must not block the next one — got ${res.status}: ${body}`
    );
  });

  it("board-completion stats are recorded, not silently skipped", async () => {
    fundPlayer(ADDR);
    seedBoardWithOneRowLeft(ADDR, 7);
    addPowerUp(ADDR, "row_bomb");

    await useRowBomb(ADDR);

    const player = getDb()
      .prepare("SELECT total_boards, best_score FROM players WHERE radix_address = ?")
      .get(ADDR) as { total_boards: number; best_score: number } | undefined;
    assert.ok(player, "player row must exist");
    assert.equal(
      player!.total_boards,
      1,
      "finishing with a Row Bomb must count as a completed board, exactly like finishing with a roll"
    );
    assert.ok(
      player!.best_score > 0,
      "the finished board's score must reach best_score — updatePlayerBoardComplete was never called on this path"
    );
  });

  it("a Row Bomb that does NOT finish the board leaves it active", async () => {
    fundPlayer(ADDR);
    // Two incomplete rows: the bomb can only clear one, so the board survives.
    const grid: Cell[][] = generateGrid();
    for (let r = 0; r < GRID_SIZE; r++) {
      for (let c = 0; c < GRID_SIZE; c++) {
        const done = r > 1;
        grid[r][c].hits = done ? grid[r][c].threshold : 0;
        grid[r][c].completed = done;
      }
    }
    const id = getDb()
      .prepare(
        `INSERT INTO boards (radix_address, grid, status, cells_completed, rolls_used)
         VALUES (?, ?, 'active', ?, ?)`
      )
      .run(ADDR, JSON.stringify(grid), GRID_SIZE * (GRID_SIZE - 2), 80)
      .lastInsertRowid as number;
    addPowerUp(ADDR, "row_bomb");

    await useRowBomb(ADDR);

    assert.equal(boardRow(id).status, "active", "the completion check must not fire early");
  });
});
