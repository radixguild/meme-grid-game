import { Router } from "express";
import { validateAddress } from "../middleware/validate";
import { requireAuth } from "../middleware/require-auth";
import { adminAuth } from "../middleware/admin-auth";
import { getDb } from "../db/connection";

const router = Router();

const FAUCET_AMOUNT = 0.5; // XRD per claim
const COOLDOWN_DAYS = 7;

// GET /api/faucet/:address/eligible — check if player can claim free XRD
router.get("/faucet/:address/eligible", validateAddress, requireAuth({ mode: "required-for-wallets" }), (req, res) => {
  const { address } = req.params;
  const db = getDb();

  const cooldownTs = Math.floor(Date.now() / 1000) - COOLDOWN_DAYS * 24 * 60 * 60;
  const recentClaim = db.prepare(`
    SELECT id, amount, status, created_at
    FROM faucet_claims
    WHERE radix_address = ? AND created_at > ? AND status != 'failed'
    ORDER BY created_at DESC
    LIMIT 1
  `).get(address, cooldownTs) as any;

  const totalClaims = (db.prepare(`
    SELECT COUNT(*) as count FROM faucet_claims
    WHERE radix_address = ? AND status != 'failed'
  `).get(address) as any)?.count ?? 0;

  if (recentClaim) {
    const nextEligible = new Date((recentClaim.created_at + COOLDOWN_DAYS * 24 * 60 * 60) * 1000).toISOString();
    res.json({
      ok: true,
      eligible: false,
      reason: `Already claimed. Next eligible: ${nextEligible}`,
      next_eligible: nextEligible,
      total_claims: totalClaims,
      faucet_amount: FAUCET_AMOUNT,
    });
    return;
  }

  res.json({
    ok: true,
    eligible: true,
    faucet_amount: FAUCET_AMOUNT,
    total_claims: totalClaims,
  });
});

// POST /api/faucet/:address/claim — request free XRD for tx fees
router.post("/faucet/:address/claim", validateAddress, requireAuth({ mode: "required-for-wallets" }), (req, res) => {
  const { address } = req.params;
  const db = getDb();

  // Check cooldown
  const cooldownTs = Math.floor(Date.now() / 1000) - COOLDOWN_DAYS * 24 * 60 * 60;
  const recentClaim = db.prepare(`
    SELECT id FROM faucet_claims
    WHERE radix_address = ? AND created_at > ? AND status != 'failed'
  `).get(address, cooldownTs);

  if (recentClaim) {
    res.status(429).json({ ok: false, error: "Faucet cooldown active. Try again later." });
    return;
  }

  // Record the claim as pending
  // Phase 1: actual XRD send is not implemented yet — needs a funded server wallet
  const result = db.prepare(`
    INSERT INTO faucet_claims (radix_address, amount, status)
    VALUES (?, ?, 'pending')
  `).run(address, FAUCET_AMOUNT);

  // TODO Phase 2: Send XRD via Radix Engine Toolkit
  // const txHash = await sendXrd(address, FAUCET_AMOUNT);
  // db.prepare("UPDATE faucet_claims SET status = 'sent', tx_hash = ? WHERE id = ?").run(txHash, result.lastInsertRowid);

  res.json({
    ok: true,
    message: `Faucet claim recorded: ${FAUCET_AMOUNT} XRD. Distribution is processed in batches.`,
    claim_id: result.lastInsertRowid,
    amount: FAUCET_AMOUNT,
    status: "pending",
  });
});

// GET /api/faucet/stats — admin: faucet stats
router.get("/faucet/stats", adminAuth, (_req, res) => {
  const db = getDb();
  const total = (db.prepare("SELECT COUNT(*) as count FROM faucet_claims").get() as any)?.count ?? 0;
  const pending = (db.prepare("SELECT COUNT(*) as count FROM faucet_claims WHERE status = 'pending'").get() as any)?.count ?? 0;
  const sent = (db.prepare("SELECT COUNT(*) as count FROM faucet_claims WHERE status = 'sent'").get() as any)?.count ?? 0;
  const totalXrd = (db.prepare("SELECT SUM(amount) as total FROM faucet_claims WHERE status != 'failed'").get() as any)?.total ?? 0;

  res.json({
    ok: true,
    stats: { total_claims: total, pending, sent, total_xrd_dispensed: totalXrd },
  });
});

export default router;
