import { Router } from "express";
import { validateAddress } from "../middleware/validate";
import { requireAuth } from "../middleware/require-auth";
import { getDb } from "../db/connection";
import { getOrCreatePlayer, getPlayerWithLevelInfo } from "../db/queries/players";
import { updateStreak, getStreakReward } from "../game/streaks";
import { addPowerUp } from "../db/queries/powerups";
import { creditRolls } from "../db/queries/roll-credits";
import { ROLL_COST } from "../game/economy";

const router = Router();

// GET /api/daily/:address — check-in, update streak, get daily reward
//
// `required-for-wallets`, same as every other address-scoped route (faucet.ts,
// powerups.ts, game.ts, vault.ts): validateAddress only proves the address is
// well-formed, never that the caller owns it, so without this a leaderboard
// address was enough to advance someone else's streak and collect their XP
// bonus / power-up. The check-in pays zero ROLLS at every streak tier
// (game/streaks.ts) so this was never a funds-drain route — the operator ruled
// 2026-09-10 to gate it anyway, as best practice, for parity with the rest of
// the address-scoped surface.
router.get("/daily/:address", validateAddress, requireAuth({ mode: "required-for-wallets" }), (req, res) => {
  const { address } = req.params;
  const db = getDb();

  try {
    const result = db.transaction(() => {
      const player = getOrCreatePlayer(address);
      const { newStreak, newLongest, todayDate } = updateStreak(
        player.streak_current ?? 0,
        player.streak_longest ?? 0,
        player.streak_last_date ?? null
      );

      const alreadyCheckedIn = player.streak_last_date === todayDate;
      const reward = getStreakReward(newStreak);

      // Update streak in DB
      db.prepare(`
        UPDATE players SET
          streak_current = ?,
          streak_longest = ?,
          streak_last_date = ?
        WHERE radix_address = ?
      `).run(newStreak, newLongest, todayDate, address);

      // Award daily reward (only if not already checked in today)
      if (!alreadyCheckedIn) {
        // Through the ledger (011) so streak grants are attributable alongside
        // purchases and, later, guild-task rolls. source_ref = the check-in date,
        // so a replayed check-in cannot double-credit.
        if (reward.freeMeme > 0) {
          creditRolls({
            address,
            amount: reward.freeMeme,
            source: "daily",
            sourceRef: `${todayDate}:meme`,
            note: `streak ${newStreak} — free ROLLS`,
          });
        }
        if (reward.freeRolls > 0) {
          // A roll costs ROLL_COST = 1 MEME (routes/game.ts), so N free rolls is N
          // MEME. This previously credited `freeRolls * 10` against a stale 10-MEME
          // roll price — a silent 10x over-credit on every streak reward.
          creditRolls({
            address,
            amount: reward.freeRolls * ROLL_COST,
            source: "daily",
            sourceRef: `${todayDate}:rolls`,
            note: `streak ${newStreak} — ${reward.freeRolls} free rolls`,
          });
        }
        if (reward.powerUp) addPowerUp(address, reward.powerUp);
      }

      return {
        streak: newStreak,
        longest_streak: newLongest,
        already_checked_in: alreadyCheckedIn,
        reward: alreadyCheckedIn ? null : reward,
        player: getPlayerWithLevelInfo(address),
      };
    })();

    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// GET /api/daily/challenge/today — today's challenge date
//
// The seed IS now threaded into board generation: `POST
// /game/:address/board/new` with `{ daily: true }` calls
// `generateGrid(getDailySeed())` (game/grid.ts), so every player who starts
// today's Daily Challenge board gets the identical grid, and it changes at
// UTC midnight. This endpoint deliberately does NOT return the numeric seed
// (it used to, back when the value was cosmetic). Now that the seed is real
// generation entropy, publishing it on this unauthenticated route would let
// anyone precompute the FULL board for every player playing today — the same
// class of leak PR #8 closed by redacting board cells. Never add `seed` back
// to this response.
router.get("/daily/challenge/today", (_req, res) => {
  const today = new Date().toISOString().split("T")[0];

  res.json({
    ok: true,
    date: today,
    grid_size: 8,
    description: "Today's Daily Challenge grid is the same for everyone — play it and chase your best score.",
  });
});

export default router;
