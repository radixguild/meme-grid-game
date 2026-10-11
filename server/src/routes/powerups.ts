import { Router } from "express";
import { validateAddress } from "../middleware/validate";
import { requireAuth } from "../middleware/require-auth";
import { safeParseInt } from "../middleware/validate";
import { getDb } from "../db/connection";
import { getPlayerPowerUps, addPowerUp, usePowerUp } from "../db/queries/powerups";
import { getActiveBoard, updateBoard, recordRoll, countCompletedBoards } from "../db/queries/boards";
import { settleBoardCompletion, checkMilestoneRewards, type RewardDrop } from "../game/rewards";
import { updatePlayerAfterRoll, updatePlayerBoardComplete, getPlayerWithLevelInfo } from "../db/queries/players";
import { checkAndAwardAchievements } from "../db/queries/achievements";
import { isBoardComplete } from "../game/engine";
import { POWER_UPS, isPowerUpType, executeRowBomb, executeCellSwap, selectSwapTarget } from "../game/powerups";
import { redactBoard } from "../game/redact";
import { checkNewLines, checkPatterns, getComboMultiplier } from "../game/patterns";

const router = Router();

// GET /api/powerups/:address — player's power-up inventory
router.get("/powerups/:address", validateAddress, requireAuth(), (req, res) => {
  const { address } = req.params;
  const inventory = getPlayerPowerUps(address);
  res.json({ ok: true, inventory, catalog: POWER_UPS });
});

// POST /api/powerups/:address/buy — buy a power-up with MEME
// `required-for-wallets`, same as every other route that moves a balance
// (game.ts board/roll, vault.ts claim): validateAddress only proves the
// address is well-formed, never that the caller owns it, so without this a
// leaderboard address was enough to spend someone else's ROLLS.
router.post(
  "/powerups/:address/buy",
  validateAddress,
  requireAuth({ mode: "required-for-wallets" }),
  (req, res) => {
  const { address } = req.params;
  const { type } = req.body;

  if (!isPowerUpType(type)) {
    res.status(400).json({ ok: false, error: "Invalid power-up type" });
    return;
  }

  const powerUp = POWER_UPS[type as keyof typeof POWER_UPS];
  const db = getDb();

  try {
    db.transaction(() => {
      const player = getPlayerWithLevelInfo(address);
      if (!player || player.meme_balance < powerUp.memeCost) {
        throw new Error(`Not enough ROLLS. Need ${powerUp.memeCost}, have ${player?.meme_balance ?? 0}.`);
      }

      updatePlayerAfterRoll(address, 0, powerUp.memeCost);
      addPowerUp(address, type);
    })();

    res.json({
      ok: true,
      message: `Bought ${powerUp.name} for ${powerUp.memeCost} ROLLS`,
      inventory: getPlayerPowerUps(address),
      player: getPlayerWithLevelInfo(address),
    });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// POST /api/powerups/:address/use — use a power-up on active board
// Gated for the same reason as /buy: this consumes inventory and mutates the
// player's live board, so it needs proof of ownership, not just a valid address.
router.post(
  "/powerups/:address/use",
  validateAddress,
  requireAuth({ mode: "required-for-wallets" }),
  (req, res) => {
  const { address } = req.params;
  const { type, row, col } = req.body;

  if (!isPowerUpType(type)) {
    res.status(400).json({ ok: false, error: "Invalid power-up type" });
    return;
  }

  const db = getDb();

  try {
    const result = db.transaction(() => {
      const board = getActiveBoard(address);
      if (!board || board.status !== "active") {
        throw new Error("No active board");
      }

      if (!usePowerUp(address, type)) {
        throw new Error(`No ${POWER_UPS[type as keyof typeof POWER_UPS].name} available`);
      }

      let message = "";
      let scoreChange = 0;
      let xpEarned = 0;
      // Which cells this power-up COMPLETED, if any. Only row_bomb completes
      // cells; swap changes a cell's type, and x_ray/magnet/reroll complete
      // nothing here (reroll defers to processRoll, which handles its own).
      let cellsCompletedBy: Array<{ row: number; col: number }> = [];

      switch (type) {
        case "row_bomb": {
          const result = executeRowBomb(board.grid);
          scoreChange = result.scoreChange;
          xpEarned = result.xpEarned;
          board.cells_completed += result.cellsCompleted;
          message = `Row Bomb! Row ${result.row + 1} cleared — ${result.cellsCompleted} cells, +${scoreChange} pts!`;
          cellsCompletedBy = board.grid[result.row].map((_, c) => ({ row: result.row, col: c }));

          // Check for line completions from the bomb
          const lines = checkNewLines(board.grid, result.row, 0);
          const combo = getComboMultiplier(lines.length);
          for (const line of lines) {
            scoreChange += Math.floor(line.reward * combo);
            xpEarned += Math.floor(line.xp * combo);
          }
          board.lines_completed = (board.lines_completed || 0) + lines.length;
          break;
        }
        case "swap": {
          const hasCoordinates = row !== undefined && col !== undefined;
          const requestedRow = hasCoordinates ? safeParseInt(row, 0, 7) : null;
          const requestedCol = hasCoordinates ? safeParseInt(col, 0, 7) : null;
          if (hasCoordinates && (requestedRow === null || requestedCol === null)) {
            addPowerUp(address, type);
            throw new Error("Invalid cell position for swap");
          }
          const target = hasCoordinates
            ? { row: requestedRow!, col: requestedCol! }
            : selectSwapTarget(board.grid);
          if (!target) {
            addPowerUp(address, type);
            throw new Error("No rug pull cells left to swap");
          }
          if (!executeCellSwap(board.grid, target.row, target.col)) {
            addPowerUp(address, type);
            throw new Error("Cell is not a rug_pull or is already completed");
          }
          message = `Cell Swap! Rug pull at [${target.row},${target.col}] changed to normal.`;
          break;
        }
        case "x_ray": {
          // X-Ray reveals all cell types for 5 rolls
          board.xray_remaining = 5;
          message = "X-Ray activated! All cell types revealed for 5 rolls.";
          xpEarned = 5;
          break;
        }
        case "reroll": {
          // Re-roll is essentially a free roll
          const { processRoll } = require("../game/engine");
          const outcome = processRoll(board.grid, 0);
          scoreChange = outcome.scoreChange;
          xpEarned = outcome.xpEarned;
          board.rolls_used += 1;
          if (outcome.cellCompleted) board.cells_completed += 1;
          if (outcome.extraTurn) board.extra_turns += 1;
          if (outcome.wildCardEarned) board.wild_cards += 1;
          if (outcome.boardCompleted) board.status = "completed";
          board.lines_completed = (board.lines_completed || 0) + (outcome.lines?.length || 0);
          message = `Re-Roll! ${outcome.message}`;

          recordRoll(board.id, address, outcome.cellRow, outcome.cellCol, outcome.cellType,
            outcome.oldHits, outcome.newHits, outcome.cellCompleted, outcome.scoreChange,
            outcome.xpEarned, "reroll", false);
          break;
        }
        case "magnet": {
          // Magnet: next 3 rolls target cells closest to completion
          board.magnet_remaining = 3;
          message = "Magnet activated! Next 3 rolls target near-complete cells.";
          xpEarned = 5;
          break;
        }
        default:
          throw new Error("Power-up not implemented");
      }

      // Ask the engine, rather than trusting each case to remember.
      //
      // Only `reroll` used to set this, because only `reroll` had a processRoll
      // outcome to copy it from. Row Bomb can land the final cells of a board and
      // silently did not — leaving `status: "active"` on a full grid, which is a
      // state the rest of the server treats as impossible: no drops, no
      // achievements, and processRoll() throws "Board is already completed" on the
      // next roll, so the board could never be finished OR rolled. The only exit
      // was abandoning it, unrefunded.
      if (board.status === "active" && isBoardComplete(board.grid)) {
        board.status = "completed";
      }

      board.score += scoreChange;
      updateBoard(board);
      updatePlayerAfterRoll(address, xpEarned, 0);

      // Pattern bonuses, scoped to the cells this power-up actually completed.
      //
      // This used to call checkPatterns(board.grid) for every non-reroll power-up,
      // which re-paid every pattern already true on the board — including for
      // x_ray, magnet and swap, none of which complete a cell. A player holding a
      // streak-earned power-up could re-trigger an already-earned pattern
      // indefinitely at zero ROLLS cost. Now a power-up can only earn a pattern by
      // completing the cell that makes it true, exactly like a roll.
      //
      // reroll is absent from cellsCompletedBy on purpose: it defers to
      // processRoll(), which awards its own patterns.
      if (cellsCompletedBy.length > 0) {
        const seen = new Set<string>();
        for (const { row: r, col: c } of cellsCompletedBy) {
          for (const p of checkPatterns(board.grid, r, c)) {
            if (seen.has(p.type)) continue;
            seen.add(p.type);
            board.score += p.reward;
            board.patterns_completed = (board.patterns_completed || 0) + 1;
          }
        }
        if (seen.size > 0) updateBoard(board);
      }

      // A power-up can land the final cell (re-roll, row bomb). The route only
      // accepts an ACTIVE board, so a status of "completed" here means this action
      // is what completed it.
      //
      // This block mirrors the completion block in routes/game.ts deliberately. It
      // used to settle lucky drops ONLY, so finishing with a Row Bomb or a Re-Roll
      // silently forfeited the achievements, the board-completion stats and the
      // meme-coin milestone every other finishing move pays. Anything added to
      // game.ts's completion block belongs here too.
      let rewardDrops: RewardDrop[] = [];
      let milestoneRewards: RewardDrop[] = [];
      let newAchievements: any[] = [];
      if (board.status === "completed") {
        const updatedPlayer = getPlayerWithLevelInfo(address)!;
        updatePlayerBoardComplete(address, board.score);
        const gridsCompleted = countCompletedBoards(address);
        newAchievements = checkAndAwardAchievements(address, {
          grids_completed: gridsCompleted,
          best_score: Math.max(updatedPlayer.best_score, board.score),
          total_rolls: updatedPlayer.total_rolls,
          level: updatedPlayer.level,
          board_id: board.id,
          board_score: board.score,
        });
        milestoneRewards = checkMilestoneRewards(address, gridsCompleted, board.id);
        rewardDrops = settleBoardCompletion(address, board.id, board.cells_completed);
      }

      return {
        message,
        scoreChange,
        xpEarned,
        board: getActiveBoard(address) ?? board,
        player: getPlayerWithLevelInfo(address),
        inventory: getPlayerPowerUps(address),
        reward_drops: [...rewardDrops, ...milestoneRewards],
        achievements: newAchievements,
      };
    })();

    res.json({ ok: true, ...result, board: redactBoard(result.board) });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
