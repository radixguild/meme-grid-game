// Reward vault engine — distributes meme coins through gameplay triggers

import { getDb } from "../db/connection";
import { randomIntInclusive, rollChance } from "./secure-random";

export interface RewardDrop {
  token_name: string;
  amount: number;
  trigger_type: string;
  trigger_detail: string;
}

/**
 * Global kill switch for reward accrual.
 *
 * Phase 1 of the game tracks earned rewards in the DB (`reward_history`) but
 * the on-chain distribution isn't wired yet — the vault component has no
 * MEME balance. Until Phase 2 is ready, set `REWARDS_ENABLED=false` in the
 * server env to stop accrual so we don't build up unbacked IOUs.
 *
 * Default: enabled (backwards-compatible with existing deployments).
 */
function rewardsEnabled(): boolean {
  return process.env.REWARDS_ENABLED !== "false";
}

// Default milestone thresholds (boards completed → reward amount)
const DEFAULT_MILESTONES = [
  { boards: 10, amount: 5 },
  { boards: 25, amount: 15 },
  { boards: 50, amount: 30 },
  { boards: 100, amount: 50 },
  { boards: 250, amount: 100 },
  { boards: 500, amount: 200 },
  { boards: 1000, amount: 500 },
];

/**
 * Settle a board's lucky drops, at COMPLETION, one roll per cell that was completed.
 *
 * Lucky drops used to fire as each cell landed, which made them the only path where
 * gameplay produced extractable value without finishing anything. That turned every
 * free ROLL into expected meme-coins: the old 500-ROLL starting balance was ~320 cell
 * completions, about 264 coins per fresh address, and the daily streak faucet added
 * ~111 a day forever. Addresses are cheap and the `account_...` faucet is bounded
 * rather than closed, so partial play had to stop paying.
 *
 * Rolling once per completed cell HERE keeps a finisher's expected payout exactly
 * what it was — the odds and the per-drop range are untouched — while a board that is
 * never finished pays nothing at all. The 15-ROLL trial cannot reach a completed
 * board, so a farmed address now yields zero.
 *
 * Call this from every path that can complete a board: an ordinary roll, a wild card,
 * and a power-up. Rewards that were already gated on completion (achievements,
 * milestones) are unaffected.
 */
export function settleBoardCompletion(
  address: string,
  boardId: number,
  cellsCompleted: number
): RewardDrop[] {
  const drops: RewardDrop[] = [];
  for (let i = 0; i < cellsCompleted; i++) {
    drops.push(...rollLuckyDrop(address, boardId));
  }
  return drops;
}

/**
 * Roll for a lucky drop. Called only by `settleBoardCompletion` — do NOT call this
 * per cell as a board is played; see the note above.
 * Checks each token in the vault with a lucky_drop config.
 * Returns array of drops (usually 0 or 1).
 */
export function rollLuckyDrop(address: string, boardId: number): RewardDrop[] {
  if (!rewardsEnabled()) return [];
  const db = getDb();
  const drops: RewardDrop[] = [];

  const configs = db.prepare(`
    SELECT rc.*, vb.remaining
    FROM reward_config rc
    JOIN vault_balances vb ON vb.token_name = rc.token_name
    WHERE rc.trigger_type = 'lucky_drop'
      AND rc.enabled = 1
      AND vb.remaining > 0
  `).all() as any[];

  for (const config of configs) {
    const chance = config.drop_chance ?? 0.15;
    if (!rollChance(chance)) continue;

    const min = config.drop_min ?? 1;
    const max = Math.min(config.drop_max ?? 10, config.remaining);
    if (max < min) continue;

    // Whole cents in [min, max], drawn uniformly. Rounded INWARD (ceil the floor,
    // floor the ceiling) so a drop can never exceed `max`, which is capped at the
    // vault's remaining balance. The epsilon absorbs float noise like 0.07 * 100.
    const minCents = Math.ceil(min * 100 - 1e-9);
    const maxCents = Math.floor(max * 100 + 1e-9);
    if (maxCents < minCents) continue;
    const amount = randomIntInclusive(minCents, maxCents) / 100;

    // Record the reward and deduct from vault
    db.prepare(`
      INSERT INTO reward_history (radix_address, token_name, amount, trigger_type, trigger_detail, board_id, status)
      VALUES (?, ?, ?, 'lucky_drop', 'cell_complete', ?, 'pending')
    `).run(address, config.token_name, amount, boardId);

    db.prepare(`
      UPDATE vault_balances SET total_distributed = total_distributed + ?, updated_at = strftime('%s','now')
      WHERE token_name = ?
    `).run(amount, config.token_name);

    drops.push({
      token_name: config.token_name,
      amount,
      trigger_type: "lucky_drop",
      trigger_detail: "cell_complete",
    });
  }

  return drops;
}

/**
 * Check and award milestone rewards on board completion.
 * Checks player's total_boards against configured milestones.
 */
export function checkMilestoneRewards(address: string, totalBoards: number, boardId: number): RewardDrop[] {
  if (!rewardsEnabled()) return [];
  const db = getDb();
  const drops: RewardDrop[] = [];

  const configs = db.prepare(`
    SELECT rc.*, vb.remaining
    FROM reward_config rc
    JOIN vault_balances vb ON vb.token_name = rc.token_name
    WHERE rc.trigger_type = 'milestone'
      AND rc.enabled = 1
      AND vb.remaining > 0
  `).all() as any[];

  for (const config of configs) {
    const milestones = config.milestone_config
      ? JSON.parse(config.milestone_config)
      : DEFAULT_MILESTONES;

    const milestone = milestones.find((m: any) => m.boards === totalBoards);
    if (!milestone) continue;

    const amount = Math.min(milestone.amount, config.remaining);
    if (amount <= 0) continue;

    // Check if already awarded this milestone for this token
    const existing = db.prepare(`
      SELECT id FROM reward_history
      WHERE radix_address = ? AND token_name = ? AND trigger_type = 'milestone' AND trigger_detail = ?
    `).get(address, config.token_name, `${totalBoards} boards`);

    if (existing) continue;

    db.prepare(`
      INSERT INTO reward_history (radix_address, token_name, amount, trigger_type, trigger_detail, board_id, status)
      VALUES (?, ?, ?, 'milestone', ?, ?, 'pending')
    `).run(address, config.token_name, amount, `${totalBoards} boards`, boardId);

    db.prepare(`
      UPDATE vault_balances SET total_distributed = total_distributed + ?, updated_at = strftime('%s','now')
      WHERE token_name = ?
    `).run(amount, config.token_name);

    drops.push({
      token_name: config.token_name,
      amount,
      trigger_type: "milestone",
      trigger_detail: `${totalBoards} boards`,
    });
  }

  return drops;
}

/**
 * Calculate tournament prizes from weekly leaderboard.
 * Returns prize allocations but does NOT distribute yet (admin triggers this).
 */
export function calculateTournamentPrizes(): Array<{ address: string; token_name: string; amount: number; rank: number }> {
  const db = getDb();
  const prizes: Array<{ address: string; token_name: string; amount: number; rank: number }> = [];

  const configs = db.prepare(`
    SELECT rc.*, vb.remaining
    FROM reward_config rc
    JOIN vault_balances vb ON vb.token_name = rc.token_name
    WHERE rc.trigger_type = 'tournament'
      AND rc.enabled = 1
      AND vb.remaining > 0
  `).all() as any[];

  // Get top 3 players by XP this week
  const weekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  const topPlayers = db.prepare(`
    SELECT radix_address, SUM(xp_earned) as weekly_xp
    FROM rolls
    WHERE created_at > ?
    GROUP BY radix_address
    ORDER BY weekly_xp DESC
    LIMIT 3
  `).all(weekAgo) as any[];

  if (topPlayers.length === 0) return prizes;

  for (const config of configs) {
    const poolPct = config.tournament_pool_pct ?? 0.1;
    const pool = config.remaining * poolPct;
    const splits = JSON.parse(config.tournament_splits || "[50, 30, 20]");

    for (let i = 0; i < Math.min(topPlayers.length, splits.length); i++) {
      const amount = Math.round(pool * (splits[i] / 100) * 100) / 100;
      if (amount <= 0) continue;

      prizes.push({
        address: topPlayers[i].radix_address,
        token_name: config.token_name,
        amount,
        rank: i + 1,
      });
    }
  }

  return prizes;
}

/**
 * Execute tournament distribution — records rewards and deducts from vault.
 */
export function distributeTournamentPrizes(weekLabel: string): RewardDrop[] {
  if (!rewardsEnabled()) return [];
  const db = getDb();
  const prizes = calculateTournamentPrizes();
  const drops: RewardDrop[] = [];

  for (const prize of prizes) {
    db.prepare(`
      INSERT INTO reward_history (radix_address, token_name, amount, trigger_type, trigger_detail, status)
      VALUES (?, ?, ?, 'tournament', ?, 'pending')
    `).run(prize.address, prize.token_name, prize.amount, `${weekLabel} #${prize.rank}`);

    db.prepare(`
      UPDATE vault_balances SET total_distributed = total_distributed + ?, updated_at = strftime('%s','now')
      WHERE token_name = ?
    `).run(prize.amount, prize.token_name);

    drops.push({
      token_name: prize.token_name,
      amount: prize.amount,
      trigger_type: "tournament",
      trigger_detail: `${weekLabel} #${prize.rank}`,
    });
  }

  return drops;
}

/**
 * Get pending (unclaimed) rewards for a player.
 */
export function getPendingRewards(address: string) {
  const db = getDb();
  return db.prepare(`
    SELECT id, token_name, amount, trigger_type, trigger_detail, created_at
    FROM reward_history
    WHERE radix_address = ? AND status = 'pending'
    ORDER BY created_at DESC
  `).all(address);
}

/**
 * Get reward history for a player (all statuses).
 */
export function getRewardHistory(address: string, limit = 50) {
  const db = getDb();
  return db.prepare(`
    SELECT id, token_name, amount, trigger_type, trigger_detail, status, created_at, claimed_at
    FROM reward_history
    WHERE radix_address = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(address, limit);
}
