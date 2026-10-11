import { Router } from "express";
import { validateAddress } from "../middleware/validate";
import { getPlayerNfts, getPlayerAchievements } from "../db/queries/achievements";
import { NFT_CATALOG, OBTAINABLE_NFT_COUNT, isObtainable } from "../game/nfts";

const router = Router();

// GET /api/nfts/catalog — full NFT catalog
//
// Every entry carries `obtainable`, which is false for the NFTs whose unlock
// conditions are not implemented yet. Clients must show the obtainable count,
// not `catalog.length`, or they advertise NFTs no player can earn.
router.get("/nfts/catalog", (_req, res) => {
  res.json({
    ok: true,
    catalog: NFT_CATALOG.map((nft) => ({ ...nft, obtainable: isObtainable(nft) })),
    obtainable_count: OBTAINABLE_NFT_COUNT,
    total_count: NFT_CATALOG.length,
  });
});

// GET /api/nfts/:address — player's unlocked NFTs
router.get("/nfts/:address", validateAddress, (req, res) => {
  const { address } = req.params;
  const nfts = getPlayerNfts(address);
  res.json({ ok: true, nfts });
});

// GET /api/achievements/:address — player achievements
router.get("/achievements/:address", validateAddress, (req, res) => {
  const { address } = req.params;
  const achievements = getPlayerAchievements(address);
  res.json({ ok: true, achievements });
});

export default router;
