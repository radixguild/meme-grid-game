import { Router } from "express";
import { validateAddress, parseLimit } from "../middleware/validate";
import { requireAuth } from "../middleware/require-auth";
import { getPlayer, getOrCreatePlayer, updatePlayerAfterRoll, updatePlayerBoardComplete, getPlayerWithLevelInfo, creditStartingBalanceOnce, getPityCounter } from "../db/queries/players";
import { getActiveBoard, createBoard, createDailyBoardOnce, getDailyBoardForDate, updateBoard, recordRoll, countCompletedBoards, getBoardHistory } from "../db/queries/boards";
import { checkAndAwardAchievements } from "../db/queries/achievements";
import { generateGrid, getDailySeed, todayUtcDate, GRID_SIZE } from "../game/grid";
import { processRoll, processWild } from "../game/engine";
import { validateNewBoard, validateRoll } from "../game/state-machine";
import { getDb } from "../db/connection";
import { addPowerUp } from "../db/queries/powerups";
import { rollForDrop, checkMilestone } from "../game/powerup-drops";
import { settleBoardCompletion, checkMilestoneRewards, type RewardDrop } from "../game/rewards";

import { BOARD_COST, ROLL_COST, FREE_STARTING_BALANCE } from "../game/economy";
import { recordCreditOnly } from "../db/queries/roll-credits";
import { isOnChainAddress } from "../middleware/validate";
import { hashIp } from "../auth/guest-id";
import { accountQuotaFor, recordStartingBalanceGrant } from "../db/queries/starting-balance-grants";
import { redactBoard } from "../game/redact";

const router = Router();

// GET /api/game/:address — full game state
// Credits free starting balance on first visit (idempotent via DB flag).
// required-for-wallets: this route funds the free starting balance on first
// visit, so a real `account_…` address needs a proven ROLA session — see
// docs/PROJECT-STATE.md items 3 and 14. A guest id is untouched: it never
// holds a ROLA session and keeps working through the legacy-style fallback.
router.get("/game/:address", validateAddress, requireAuth({ mode: "required-for-wallets" }), (req, res) => {
  const { address } = req.params;

  // ── Meter the free starting balance for wallet addresses ──────────────
  // A Radix account address is self-asserted: validateAddress proves the
  // checksum is real, but nobody proves OWNERSHIP while ROLA_AUTH_MODE is
  // `legacy`. Someone generating keypairs offline can derive unlimited valid
  // addresses, so the checksum alone does not bound the giveaway — this does.
  // See docs/PROJECT-STATE.md item 14.
  //
  // Scoped to first-time funding and to `account_` addresses only:
  //   * an established player is never gated, whatever their network is doing
  //   * guests are already metered upstream at POST /api/guest/new, and
  //     charging them here too would spend from two budgets for one identity
  const existing = getPlayer(address);
  const needsFunding = !existing || existing.starting_balance_credited === 0;
  const meterThisAddress = needsFunding && isOnChainAddress(address);
  const ipHash = meterThisAddress ? hashIp(req.ip || "unknown") : null;

  if (ipHash) {
    const quota = accountQuotaFor(ipHash);
    if (quota.remaining <= 0) {
      // 429, not 403: a rate, not a permission. Existing accounts are unaffected,
      // so say that — the reader is most likely a real person on a shared network.
      res.status(429).json({
        ok: false,
        error:
          `This network has already had ${quota.quota} new accounts funded today. ` +
          `Accounts that have already played are unaffected — try again tomorrow.`,
        code: "starting_balance_quota",
        quota: quota.quota,
      });
      return;
    }
  }

  getOrCreatePlayer(address);
  // creditStartingBalanceOnce is already idempotent via its own DB flag; it stays
  // the gate. The ledger row is recorded only when it actually credited, so the
  // free-start giveaway shows up in the source breakdown alongside purchases.
  if (creditStartingBalanceOnce(address, FREE_STARTING_BALANCE)) {
    recordCreditOnly({
      address,
      amount: FREE_STARTING_BALANCE,
      source: "free_start",
      sourceRef: address, // one free start per address, ever
      note: "Phase 1 free starting balance",
    });
    // Only after the credit actually landed — recording a grant that never
    // happened would spend the IP's quota for nothing.
    if (ipHash) recordStartingBalanceGrant(address, ipHash);
  }

  const playerInfo = getPlayerWithLevelInfo(address);
  const board = getActiveBoard(address);
  const gridsCompleted = countCompletedBoards(address);

  res.json({
    ok: true,
    player: playerInfo,
    board: board ? redactBoard(board) : null,
    grids_completed: gridsCompleted,
  });
});

// GET /api/game/:address/history — board history
router.get("/game/:address/history", validateAddress, requireAuth(), (req, res) => {
  const { address } = req.params;
  const limit = parseLimit(req.query.limit, 10, 50);
  const boards = getBoardHistory(address, limit);
  // Strip full grid data — just return stats
  const history = boards.map(({ grid, ...rest }) => rest);
  res.json({ ok: true, history });
});

// POST /api/game/:address/board/new — create new board (transactional)
// Body: { daily?: boolean } — when true, the board is generated from today's
// UTC-date seed (game/grid.ts::getDailySeed) instead of the CSPRNG, so
// every player who starts a Daily Challenge board on the same day gets the
// identical grid. Omitted/false is unchanged: a fresh random grid.
//
// Once-per-day-per-account guard (operator ruling 2026-08-13): an account
// (guest_* included — validateAddress accepts both) may create at most one
// `{daily: true}` board per UTC day. A repeat attempt the same day is
// idempotent — it returns the board already created today instead of erroring
// or minting a second row of the same (deterministic) layout, which would let
// a player replay a board whose cell types they already know. Enforced by the
// DB unique index in migration 014 (see queries/boards.ts::createDailyBoardOnce);
// the pre-check below just avoids charging BOARD_COST on the expected path.
router.post("/game/:address/board/new", validateAddress, requireAuth({ mode: "required-for-wallets" }), (req, res) => {
  const { address } = req.params;
  const isDaily = req.body?.daily === true;
  const db = getDb();

  try {
    const result = db.transaction(() => {
      getOrCreatePlayer(address);
      const currentPlayer = getPlayerWithLevelInfo(address)!;
      const todayUtc = isDaily ? todayUtcDate() : null;

      if (isDaily) {
        const existingToday = getDailyBoardForDate(address, todayUtc!);
        if (existingToday) {
          return { board: existingToday, player: currentPlayer, alreadyExisted: true };
        }
      }

      const activeBoard = getActiveBoard(address);
      validateNewBoard(activeBoard?.status as any ?? null);

      if (currentPlayer.meme_balance < BOARD_COST) {
        throw new Error(`Not enough ROLLS. Need ${BOARD_COST}, have ${currentPlayer.meme_balance}.`);
      }

      const grid = isDaily ? generateGrid(getDailySeed(todayUtc!)) : generateGrid();

      if (isDaily) {
        // Charge only AFTER a confirmed insert — if this loses a race against a
        // concurrent request for the same account+day (createDailyBoardOnce's
        // INSERT hits the unique index), nothing was ever spent, so there is
        // nothing to refund.
        const dailyResult = createDailyBoardOnce(address, grid, todayUtc!);
        if (!dailyResult.created) {
          return { board: dailyResult.board, player: currentPlayer, alreadyExisted: true };
        }
        updatePlayerAfterRoll(address, 0, BOARD_COST);
        return { board: dailyResult.board, player: getPlayerWithLevelInfo(address), alreadyExisted: false };
      }

      updatePlayerAfterRoll(address, 0, BOARD_COST);
      const board = createBoard(address, grid);
      return { board, player: getPlayerWithLevelInfo(address), alreadyExisted: false };
    })();

    res.json({
      ok: true,
      board: redactBoard(result.board),
      player: result.player,
      message: result.alreadyExisted
        ? "You already started today's Daily Challenge — here's your board."
        : isDaily
          // BOARD_COST is 0, so "0 ROLLS spent" is both noise and slightly alarming.
          // Kept conditional rather than hardcoded free, so the wording follows the
          // number if a board ever costs something again.
          ? `Daily Challenge board created!${BOARD_COST > 0 ? ` ${BOARD_COST} ROLLS spent.` : ""}`
          : `New board created!${BOARD_COST > 0 ? ` ${BOARD_COST} ROLLS spent.` : ""}`,
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// POST /api/game/:address/board/roll — execute a roll (transactional)
router.post("/game/:address/board/roll", validateAddress, requireAuth({ mode: "required-for-wallets" }), (req, res) => {
  const { address } = req.params;
  const db = getDb();

  try {
    const result = db.transaction(() => {
      const board = getActiveBoard(address);
      validateRoll(board?.status as any ?? null);

      const player = getPlayerWithLevelInfo(address)!;
      const oldLevel = player.level;
      const useExtra = board!.extra_turns > 0;
      const cost = useExtra ? 0 : ROLL_COST;

      if (!useExtra && player.meme_balance < ROLL_COST) {
        throw new Error(`Not enough ROLLS. Need ${ROLL_COST}, have ${player.meme_balance}.`);
      }

      const pityCounter = getPityCounter(address);
      const magnetActive = (board!.magnet_remaining ?? 0) > 0;
      const outcome = processRoll(board!.grid, pityCounter, magnetActive);

      // Update board state
      board!.score += outcome.scoreChange;
      board!.rolls_used += 1;
      if (useExtra) board!.extra_turns -= 1;
      if (outcome.extraTurn) board!.extra_turns += 1;
      if (outcome.wildCardEarned) board!.wild_cards += 1;
      if (outcome.cellCompleted) board!.cells_completed += 1;
      if (outcome.boardCompleted) board!.status = "completed";
      board!.lines_completed = (board!.lines_completed || 0) + outcome.lines.length;
      board!.patterns_completed = (board!.patterns_completed || 0) + outcome.patterns.length;

      // Decrement active power-up counters
      if (board!.xray_remaining > 0) board!.xray_remaining -= 1;
      if (board!.magnet_remaining > 0) board!.magnet_remaining -= 1;

      updateBoard(board!);

      // Record roll audit
      const specialEffect = outcome.extraTurn ? "extra_turn" : outcome.wildCardEarned ? "wild_card" : null;
      recordRoll(
        board!.id, address, outcome.cellRow, outcome.cellCol, outcome.cellType,
        outcome.oldHits, outcome.newHits, outcome.cellCompleted, outcome.scoreChange,
        outcome.xpEarned, specialEffect, useExtra
      );

      // Update player XP, balance, and pity counter
      const newPity = outcome.cellCompleted ? 0 : pityCounter + 1;
      updatePlayerAfterRoll(address, outcome.xpEarned, cost);
      db.prepare("UPDATE players SET pity_counter = ? WHERE radix_address = ?").run(newPity, address);

      // Check achievements on board completion
      let newAchievements: any[] = [];
      let milestoneRewards: RewardDrop[] = [];
      let rewardDrops: RewardDrop[] = [];
      if (outcome.boardCompleted) {
        const updatedPlayer = getPlayerWithLevelInfo(address)!;
        updatePlayerBoardComplete(address, board!.score);
        const gridsCompleted = countCompletedBoards(address);
        newAchievements = checkAndAwardAchievements(address, {
          grids_completed: gridsCompleted,
          best_score: Math.max(updatedPlayer.best_score, board!.score),
          total_rolls: updatedPlayer.total_rolls,
          level: updatedPlayer.level,
          board_id: board!.id,
          board_score: board!.score,
        });
        // Meme-coin milestone rewards from vault
        milestoneRewards = checkMilestoneRewards(address, gridsCompleted, board!.id);
        // Lucky drops settle here, not per cell — an unfinished board pays nothing.
        rewardDrops = settleBoardCompletion(address, board!.id, board!.cells_completed);
      }

      // Power-up drops on cell completion
      const powerUpDrops: Array<{ type: string; reason: string }> = [];
      if (outcome.cellCompleted) {
        // Random drop (~15% chance)
        const randomDrop = rollForDrop();
        if (randomDrop) {
          addPowerUp(address, randomDrop.type);
          powerUpDrops.push(randomDrop);
        }
        // Milestone award (at 8, 16, 24, 32, 48, 56 cells)
        const milestone = checkMilestone(board!.cells_completed);
        if (milestone) {
          addPowerUp(address, milestone.type);
          powerUpDrops.push(milestone);
        }
      }

      const updatedPlayerFinal = getPlayerWithLevelInfo(address)!;
      const leveledUp = updatedPlayerFinal.level > oldLevel;

      // Combine all reward drops
      const allRewardDrops = [...rewardDrops, ...milestoneRewards];

      return {
        outcome,
        board: getActiveBoard(address) ?? { ...board!, status: "completed" },
        player: updatedPlayerFinal,
        achievements: newAchievements,
        power_up_drops: powerUpDrops,
        reward_drops: allRewardDrops,
        leveled_up: leveledUp ? {
          new_level: updatedPlayerFinal.level,
          level_name: updatedPlayerFinal.level_name,
          level_emoji: updatedPlayerFinal.level_emoji,
        } : null,
      };
    })();

    res.json({ ok: true, ...result, board: redactBoard(result.board) });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// POST /api/game/:address/board/wild — use wild card to complete a targeted cell
router.post("/game/:address/board/wild", validateAddress, requireAuth({ mode: "required-for-wallets" }), (req, res) => {
  const { address } = req.params;
  const { row, col } = req.body;
  const db = getDb();

  try {
    const result = db.transaction(() => {
      const board = getActiveBoard(address);
      if (!board || board.status !== "active") {
        throw new Error("No active board");
      }
      if (board.wild_cards <= 0) {
        throw new Error("No wild cards available");
      }
      const rowNum = parseInt(String(row), 10);
      const colNum = parseInt(String(col), 10);
      if (
        isNaN(rowNum) || isNaN(colNum) ||
        rowNum < 0 || rowNum >= GRID_SIZE ||
        colNum < 0 || colNum >= GRID_SIZE
      ) {
        throw new Error("Invalid cell coordinates");
      }

      // Wild card = targeted cell completion
      const outcome = processWild(board.grid, rowNum, colNum);

      board.wild_cards -= 1;
      board.score += outcome.scoreChange;
      board.rolls_used += 1;
      if (outcome.cellCompleted) board.cells_completed += 1;
      if (outcome.extraTurn) board.extra_turns += 1;
      if (outcome.wildCardEarned) board.wild_cards += 1;
      if (outcome.boardCompleted) board.status = "completed";
      board.lines_completed = (board.lines_completed || 0) + outcome.lines.length;
      board.patterns_completed = (board.patterns_completed || 0) + outcome.patterns.length;

      updateBoard(board);

      recordRoll(
        board.id, address, outcome.cellRow, outcome.cellCol, outcome.cellType,
        outcome.oldHits, outcome.newHits, outcome.cellCompleted, outcome.scoreChange,
        outcome.xpEarned, "wild_free_roll", false
      );

      updatePlayerAfterRoll(address, outcome.xpEarned, 0);

      let newAchievements: any[] = [];
      let rewardDrops: RewardDrop[] = [];
      if (outcome.boardCompleted) {
        updatePlayerBoardComplete(address, board.score);
        const player = getPlayerWithLevelInfo(address)!;
        const gridsCompleted = countCompletedBoards(address);
        newAchievements = checkAndAwardAchievements(address, {
          grids_completed: gridsCompleted,
          best_score: Math.max(player.best_score, board.score),
          total_rolls: player.total_rolls,
          level: player.level,
          board_id: board.id,
          board_score: board.score,
        });
        // A board finished on a wild card is still a finished board. This path
        // awarded achievements but never milestone rewards — a pre-existing gap that
        // only showed up once drops moved to completion, since the last cell landing
        // on a wild would otherwise pay nothing at all.
        rewardDrops = [
          ...checkMilestoneRewards(address, gridsCompleted, board.id),
          ...settleBoardCompletion(address, board.id, board.cells_completed),
        ];
      }

      return {
        outcome: { ...outcome, message: `Free roll (wild card)! ${outcome.message}` },
        board: getActiveBoard(address) ?? { ...board, status: "completed" },
        player: getPlayerWithLevelInfo(address),
        achievements: newAchievements,
        reward_drops: rewardDrops,
      };
    })();

    res.json({ ok: true, ...result, board: redactBoard(result.board) });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// POST /api/game/:address/board/abandon
// required-for-wallets, like board/new and roll: abandoning destroys a live
// board (no refund, and a daily board cannot be restarted that UTC day), so it
// needs proof of ownership. On the bare requireAuth() it fell back to the env
// default `legacy`, which trusts the URL — anyone holding a leaderboard address
// could abandon that player's board (MG-2, 2026-10-06). Guests are unaffected.
router.post("/game/:address/board/abandon", validateAddress, requireAuth({ mode: "required-for-wallets" }), (req, res) => {
  const { address } = req.params;

  try {
    const db = getDb();
    db.transaction(() => {
      const board = getActiveBoard(address);
      if (!board || board.status !== "active") {
        throw new Error("No active board to abandon");
      }
      board.status = "abandoned";
      updateBoard(board);
    })();

    res.json({
      ok: true,
      message: "Board abandoned. No refund.",
      player: getPlayerWithLevelInfo(address),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
