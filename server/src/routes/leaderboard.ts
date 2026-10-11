import { Router } from "express";
import { parseLimit } from "../middleware/validate";
import { getTopByXp, getTopByScore, getTopByGrids, getTotalPlayers, getTotalBoards } from "../db/queries/leaderboard";

const router = Router();

router.get("/leaderboard", (req, res) => {
  const sort = (req.query.sort as string) || "xp";
  const limit = parseLimit(req.query.limit, 20, 100);

  let entries;
  switch (sort) {
    case "score":
      entries = getTopByScore(limit);
      break;
    case "grids":
      entries = getTopByGrids(limit);
      break;
    default:
      entries = getTopByXp(limit);
  }

  res.json({
    ok: true,
    sort,
    entries,
    stats: {
      total_players: getTotalPlayers(),
      total_boards: getTotalBoards(),
    },
  });
});

export default router;
