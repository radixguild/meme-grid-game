import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";

// Constant-time token compare. Returns false if `expected` is missing or
// lengths differ; otherwise uses crypto.timingSafeEqual so attackers cannot
// infer token content by measuring early-exit on the first differing byte.
// Length mismatch returns false without running the compare — length leak
// is acceptable because admin tokens are of known fixed length by convention.
function safeTokenEqual(provided: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

// ── Admin-specific rate limiting ──────────────────────────────────────────

const adminWindows = new Map<string, { count: number; resetAt: number }>();
const ADMIN_WINDOW_MS = 60_000;
const ADMIN_MAX_REQUESTS = 20;

// Cleanup stale admin windows every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, window] of adminWindows) {
    if (now > window.resetAt) adminWindows.delete(key);
  }
}, 5 * 60_000);

// ── Admin auth middleware ─────────────────────────────────────────────────

export function adminAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers["x-admin-token"];

  // Token validation
  if (!token || typeof token !== "string") {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  // Check token expiry (fail closed on invalid config — silent skip would
  // let an operator accidentally disable expiry via a malformed env var)
  const expiresAtRaw = process.env.ADMIN_TOKEN_EXPIRES_AT;
  if (expiresAtRaw) {
    const expiryTime = expiresAtRaw.includes("T")
      ? new Date(expiresAtRaw).getTime()
      : parseInt(expiresAtRaw, 10) * 1000;
    if (!Number.isFinite(expiryTime)) {
      console.error(
        `[admin-auth] Invalid ADMIN_TOKEN_EXPIRES_AT: ${JSON.stringify(expiresAtRaw)}`
      );
      res.status(500).json({ ok: false, error: "Admin auth misconfigured" });
      return;
    }
    if (Date.now() > expiryTime) {
      res.status(401).json({ ok: false, error: "Admin token expired" });
      return;
    }
  }

  // Accept current token or previous token (for rotation). Evaluate both
  // compares before the OR so a match on `current` doesn't short-circuit
  // away the `previous` compare — otherwise an attacker could distinguish
  // "which token matched" via timing.
  const current = safeTokenEqual(token, process.env.ADMIN_TOKEN);
  const previous = safeTokenEqual(token, process.env.ADMIN_TOKEN_PREVIOUS);
  const validToken = current || previous;

  if (!validToken) {
    res.status(401).json({ ok: false, error: "Unauthorized" });
    return;
  }

  // Admin rate limiting
  const ip = req.ip || "unknown";
  const key = `admin:${ip}`;
  const now = Date.now();

  let window = adminWindows.get(key);
  if (!window || now > window.resetAt) {
    window = { count: 0, resetAt: now + ADMIN_WINDOW_MS };
    adminWindows.set(key, window);
  }

  window.count++;
  if (window.count > ADMIN_MAX_REQUESTS) {
    res.status(429).json({ ok: false, error: "Admin rate limit exceeded" });
    return;
  }

  console.log(`[admin-auth] ${req.method} ${req.path} from ${req.ip}`);
  next();
}
