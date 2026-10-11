import { Router } from "express";
import { getDb } from "../db/connection";
import { getTotalPlayers, getTotalBoards } from "../db/queries/leaderboard";
import { adminAuth } from "../middleware/admin-auth";
import { getNetwork } from "../config/env";

const router = Router();

/**
 * The `system` block of GET /api/admin/stats. Exported as a pure function
 * so a test can call it without spinning up the route/DB, and so this is
 * the one place that decides what the admin panel is told about the
 * server's own configuration.
 *
 * `network` MUST come from getNetwork() (server/src/config/env.ts), not
 * from NEXT_PUBLIC_NETWORK or a hardcoded default. NEXT_PUBLIC_NETWORK is a
 * frontend build-time var that is never present in the server's own env, so
 * reading it here — or falling back to a literal "mainnet" — reported a
 * fabricated "mainnet" on every deployment regardless of the RADIX_NETWORK
 * the server actually booted with, including a stokenet box.
 */
export function systemInfo() {
  return {
    version: "0.1.0",
    uptime: process.uptime(),
    network: getNetwork() ?? "unknown",
    vault_component: process.env.VAULT_COMPONENT || null,
    meme_resource: process.env.MEME_RESOURCE || null,
  };
}

// GET /api/admin/stats — full system stats
router.get("/admin/stats", adminAuth, (_req, res) => {
  const db = getDb();

  const players = getTotalPlayers();
  const boards = getTotalBoards();

  const totalRolls = (db.prepare("SELECT SUM(total_rolls) as total FROM players").get() as any)?.total ?? 0;
  const totalMemeDeposited = (db.prepare("SELECT SUM(total_meme_deposited) as total FROM players").get() as any)?.total ?? 0;
  const totalMemeSpent = (db.prepare("SELECT SUM(total_meme_spent) as total FROM players").get() as any)?.total ?? 0;
  const activeBoards = (db.prepare("SELECT COUNT(*) as count FROM boards WHERE status = 'active'").get() as any)?.count ?? 0;
  const abandonedBoards = (db.prepare("SELECT COUNT(*) as count FROM boards WHERE status = 'abandoned'").get() as any)?.count ?? 0;
  const totalAchievements = (db.prepare("SELECT COUNT(*) as count FROM achievements").get() as any)?.count ?? 0;
  const totalNfts = (db.prepare("SELECT COUNT(*) as count FROM nft_unlocks").get() as any)?.count ?? 0;
  const totalDeposits = (db.prepare("SELECT COUNT(*) as count FROM deposits").get() as any)?.count ?? 0;
  const totalPowerUps = (db.prepare("SELECT SUM(quantity) as total FROM powerups").get() as any)?.total ?? 0;
  const highestScore = (db.prepare("SELECT MAX(score) as max FROM boards WHERE status = 'completed'").get() as any)?.max ?? 0;
  const avgScore = (db.prepare("SELECT AVG(score) as avg FROM boards WHERE status = 'completed'").get() as any)?.avg ?? 0;

  // Recent activity
  const recentPlayers = db.prepare("SELECT radix_address, level, xp, meme_balance, total_rolls, last_active FROM players ORDER BY last_active DESC LIMIT 10").all();
  const recentBoards = db.prepare("SELECT id, radix_address, score, rolls_used, cells_completed, status, created_at FROM boards ORDER BY id DESC LIMIT 10").all();

  res.json({
    ok: true,
    system: systemInfo(),
    stats: {
      players,
      boards_completed: boards,
      boards_active: activeBoards,
      boards_abandoned: abandonedBoards,
      total_rolls: totalRolls,
      total_meme_deposited: totalMemeDeposited,
      total_meme_spent: totalMemeSpent,
      total_achievements: totalAchievements,
      total_nfts: totalNfts,
      total_deposits: totalDeposits,
      total_powerups: totalPowerUps,
      highest_score: highestScore,
      avg_score: Math.round(avgScore),
    },
    recent_players: recentPlayers,
    recent_boards: recentBoards,
  });
});

export default router;
