/**
 * requireAuth — gate a route by a valid session token.
 *
 * Usage:
 *   app.get("/api/game/:address", requireAuth(), (req, res) => {
 *     // req.verifiedAddress is guaranteed to match req.params.address
 *     // (unless the effective mode is "legacy", in which case we fall
 *     // back to trusting the URL-param address — transitional only)
 *   });
 *
 *   // Per-route override — takes precedence over ROLA_AUTH_MODE:
 *   app.post("/api/game/:address/board/new", requireAuth({ mode: "required-for-wallets" }), ...);
 *
 * Modes (selected via env `ROLA_AUTH_MODE`, or per-call via `opts.mode`):
 *   "required"             — any request without a valid session → 401
 *   "optional"              — valid session attaches req.verifiedAddress;
 *                            missing/invalid → continue without it (useful
 *                            for endpoints that want to show different
 *                            content to auth'd users)
 *   "legacy"                — default during rollout. Accept either a
 *                            session OR fall back to trusting
 *                            req.params.address. Log a deprecation
 *                            warning on the fallback.
 *   "required-for-wallets"  — a session is required ONLY when the URL
 *                            address is a real on-chain `account_…`
 *                            address (`isOnChainAddress`); a guest id
 *                            (or anything else that isn't on-chain
 *                            shaped) is trusted from the URL exactly like
 *                            "legacy". A guest can never hold a ROLA
 *                            session — see docs/PROJECT-STATE.md item 3 —
 *                            so this is the mode that closes the
 *                            self-asserted `account_…` funding hole
 *                            (item 14) on money-moving routes without
 *                            touching guest play. Do NOT flip
 *                            `ROLA_AUTH_MODE` globally to this or
 *                            "required" — apply it per-route instead.
 *
 * `opts.mode` is a hard override: when set, it is used verbatim and the
 * `ROLA_AUTH_MODE` env var is never consulted for that call site. This is
 * how a route opts into "required-for-wallets" while every other route
 * (and the env default) stays on "legacy".
 */

import type { Request, Response, NextFunction } from "express";
import { lookupSession } from "../auth/session";
import { isOnChainAddress } from "./validate";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      verifiedAddress?: string;
    }
  }
}

export type Mode = "required" | "optional" | "legacy" | "required-for-wallets";

const VALID_MODES: readonly Mode[] = ["required", "optional", "legacy", "required-for-wallets"];

function envMode(): Mode {
  const env = (process.env.ROLA_AUTH_MODE || "legacy").toLowerCase();
  return (VALID_MODES as readonly string[]).includes(env) ? (env as Mode) : "legacy";
}

export function requireAuth(opts: { addressParam?: string; mode?: Mode } = {}) {
  const addressParam = opts.addressParam ?? "address";

  return function (req: Request, res: Response, next: NextFunction) {
    // A per-call `opts.mode` always wins over the env default — that is the
    // whole point of the override (see module doc). Only fall back to the
    // env var when the call site didn't pin a mode.
    const m: Mode = opts.mode ?? envMode();
    const claimed = firstString(req.params[addressParam]);
    const claimedIsOnChain = !!claimed && isOnChainAddress(claimed);

    const authHeader = req.headers.authorization ?? "";
    const match = /^Bearer\s+([a-f0-9]{64})$/i.exec(authHeader);
    const token = match?.[1];

    if (token) {
      const session = lookupSession(token);
      if (session) {
        if (claimed && claimed !== session.radix_address) {
          res.status(403).json({
            ok: false,
            error: "Session address does not match URL address",
          });
          return;
        }
        req.verifiedAddress = session.radix_address;
        next();
        return;
      }
      // Bad or expired token. Only hard-fail here for modes that always
      // require a session, or for required-for-wallets on an on-chain URL
      // address — a guest (or a "required-for-wallets" request with no
      // on-chain address in the URL) still falls through to the
      // legacy-style trust below.
      if (m === "required" || (m === "required-for-wallets" && claimedIsOnChain)) {
        res.status(401).json({ ok: false, error: "Invalid or expired session" });
        return;
      }
    }

    if (m === "required") {
      res.status(401).json({ ok: false, error: "Authentication required" });
      return;
    }

    if (m === "required-for-wallets" && claimedIsOnChain) {
      // A real Radix account address with no valid session. This is exactly
      // the item-14 hole: anyone can derive a valid `account_…` address
      // offline, so the checksum alone is not proof of ownership. A guest
      // id never reaches this branch — guests are excluded by
      // `claimedIsOnChain` above and keep working unchanged.
      res.status(401).json({ ok: false, error: "Authentication required for wallet accounts" });
      return;
    }

    if (m === "legacy" || m === "required-for-wallets") {
      if (claimed) {
        // Legacy fallback — log once per IP per hour so we can measure
        // the migration pace without spamming.
        logLegacyFallback(req.ip, claimed);
        req.verifiedAddress = claimed; // UNVERIFIED — for backwards compat only
      }
    }

    next();
  };
}

// Express params can be string | string[] when the route uses repeated
// path segments — we only care about the single-value case here.
function firstString(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

// ── Legacy fallback telemetry ───────────────────────────────────────

const legacyLastLogged = new Map<string, number>();
const LEGACY_LOG_TTL_MS = 60 * 60 * 1000;

function logLegacyFallback(ip: string | undefined, address: string) {
  const key = `${ip ?? "unknown"}|${address}`;
  const now = Date.now();
  const last = legacyLastLogged.get(key) ?? 0;
  if (now - last < LEGACY_LOG_TTL_MS) return;
  legacyLastLogged.set(key, now);
  console.warn(
    `[auth] legacy fallback accepted for ${address} from ${ip ?? "unknown"} (ROLA not yet used)`
  );
  // cheap map cleanup: every ~100 entries
  if (legacyLastLogged.size > 100) {
    legacyLastLogged.forEach((t, k) => {
      if (now - t > LEGACY_LOG_TTL_MS) legacyLastLogged.delete(k);
    });
  }
}
