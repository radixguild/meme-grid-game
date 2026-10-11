import { Router } from "express";
import { getDb } from "../db/connection";
import { getTotalPlayers, getTotalBoards } from "../db/queries/leaderboard";

const router = Router();

router.get("/health", (_req, res) => {
  try {
    getDb().prepare("SELECT 1").get();
    res.json({
      ok: true,
      version: "0.1.0",
      uptime: process.uptime(),
      players: getTotalPlayers(),
      boards: getTotalBoards(),
    });
  } catch {
    res.status(500).json({ ok: false, error: "Database unavailable" });
  }
});

export default router;
