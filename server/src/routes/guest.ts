import { Router } from "express";
import {
  guestQuotaFor,
  hashIp,
  issueGuestIdWithinQuota,
  guestQuotaPerIp,
  GUEST_QUOTA_WINDOW_SEC,
} from "../auth/guest-id";

const router = Router();

/**
 * POST /api/guest/new — hand out one signed guest id.
 *
 * The only way to obtain a playable guest identity. Guest ids used to be minted
 * in the browser and accepted on shape alone, which made "clear sessionStorage"
 * equivalent to "mint another 500 free MEME" (docs/GAME-DESIGN-REVIEW.md §5).
 * Everything a guest can do is now downstream of this one metered call.
 *
 * No auth, by design — a guest has no wallet to prove anything with. The bound
 * is the per-IP quota below, on top of the global limiter in
 * middleware/rate-limit.ts.
 */
router.post("/guest/new", (req, res) => {
  const ipHash = hashIp(req.ip || "unknown");
  const userAgent = typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null;

  const result = issueGuestIdWithinQuota(ipHash, userAgent);

  if (!result.ok) {
    // 429, not 403: this is a rate, not a permission. Say what the limit is —
    // a real player who hits it (shared office NAT, say) can only act on the
    // message if it tells them the wallet path exists.
    res.status(429).json({
      ok: false,
      error:
        `Guest limit reached — ${result.quota} guest sessions per day from this network. ` +
        `Connect a Radix wallet to keep playing, or try again tomorrow.`,
      quota: result.quota,
      window_hours: GUEST_QUOTA_WINDOW_SEC / 3600,
    });
    return;
  }

  res.json({ ok: true, guest_id: result.guestId, remaining: result.remaining });
});

/**
 * GET /api/guest/quota — what this IP has left, without spending one.
 *
 * Lets the client show the real reason a guest button is unavailable instead of
 * discovering it by burning an attempt. Reveals nothing an attacker couldn't
 * learn by calling POST until it 429s.
 */
router.get("/guest/quota", (req, res) => {
  const state = guestQuotaFor(hashIp(req.ip || "unknown"));
  res.json({
    ok: true,
    used: state.used,
    quota: guestQuotaPerIp(),
    remaining: state.remaining,
    window_hours: GUEST_QUOTA_WINDOW_SEC / 3600,
  });
});

export default router;
