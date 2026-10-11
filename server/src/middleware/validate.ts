import type { Request, Response, NextFunction } from "express";
import { isValidGuestId, looksLikeGuestId } from "../auth/guest-id";
import { isValidAccountAddress } from "../auth/address-validation";

// Radix address OR guest address validation
const RADIX_ADDRESS_REGEX = /^account_(rdx|tdx_2_)1[a-z0-9]{40,65}$/;

/**
 * True only for real on-chain Radix accounts — guest pseudo-addresses
 * ("guest_ab12…") return false. Gate anything that puts an address into a
 * transaction manifest on this: a guest address in a manifest is not a
 * valid Address() and the transaction cannot build.
 */
export function isOnChainAddress(address: string): boolean {
  return RADIX_ADDRESS_REGEX.test(address);
}

/**
 * The single choke point every `/:address` route passes through — a request
 * that fails here never reaches `getOrCreatePlayer`, so it can never create a
 * player row or collect a starting balance.
 *
 * A guest address is no longer accepted on SHAPE. It must carry a signature
 * this server produced (auth/guest-id.ts), because the free 500-MEME starting
 * balance is granted once per new address: accepting any `guest_xxxxxxxx` a
 * client invented made "clear sessionStorage" a mint button
 * (docs/GAME-DESIGN-REVIEW.md §5). Guest ids now come from POST /api/guest/new,
 * which is metered per IP.
 *
 * Radix accounts are checked for real now, not just matched against a shape.
 * The old comment here claimed they were "self-authenticating enough for this
 * layer" — that conflated "the address is derived from a keypair" with "the
 * caller proved they hold it", which `ROLA_AUTH_MODE=legacy` never checks. The
 * regex has no bech32m checksum, so `account_rdx1` + 45 arbitrary characters
 * passed and got funded. See docs/PROJECT-STATE.md item 14.
 *
 * Async because the checksum comes from the WASM-backed toolkit. Every rejection
 * path answers the request itself, so this never rejects its promise and never
 * reaches the Express error handler.
 */
export async function validateAddress(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const address = req.params.address;
  if (!address) {
    res.status(400).json({ ok: false, error: "Address is required" });
    return;
  }

  if (RADIX_ADDRESS_REGEX.test(address)) {
    // Shape first (cheap, rejects garbage without touching WASM), then the real
    // check: valid checksum, an account entity, on the configured network.
    if (await isValidAccountAddress(address)) {
      next();
      return;
    }
    res.status(400).json({
      ok: false,
      error: "Not a valid Radix account address on this network.",
      code: "address_invalid",
    });
    return;
  }

  if (looksLikeGuestId(address)) {
    if (isValidGuestId(address)) {
      next();
      return;
    }
    // Distinct message from "invalid format": the client's stored guest id is
    // well-formed but not one we issued (self-minted, or from before the key
    // rotated). The fix is to ask for a new one, so say so — a bare 400 would
    // strand that browser on a dead id with no signal to clear it.
    res.status(401).json({
      ok: false,
      error: "Guest session is not recognised. Start a new guest session to continue.",
      code: "guest_id_invalid",
    });
    return;
  }

  res.status(400).json({ ok: false, error: "Invalid address format" });
}

export function validateBody(...requiredFields: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    for (const field of requiredFields) {
      if (req.body[field] === undefined) {
        res.status(400).json({ ok: false, error: `Missing required field: ${field}` });
        return;
      }
    }
    next();
  };
}

/**
 * Safely parse an integer from user input with bounds checking.
 * Returns null if invalid.
 */
export function safeParseInt(value: unknown, min: number, max: number): number | null {
  if (value === undefined || value === null) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num)) return null;
  if (num < min || num > max) return null;
  return num;
}

/**
 * Parse a `?limit=` query value for a list route: the first value if repeated,
 * `fallback` when absent or not an integer, otherwise clamped to [1, max].
 *
 * The routes used `Math.min(parseInt(q) || fallback, max)`, which lets a
 * negative value through — and SQLite reads `LIMIT -1` as "no limit", so
 * `?limit=-1` returned every row (MG-7).
 */
export function parseLimit(value: unknown, fallback: number, max: number): number {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = typeof raw === "string" && /^-?\d+$/.test(raw.trim()) ? Number(raw.trim()) : NaN;
  if (!Number.isSafeInteger(n)) return fallback;
  return Math.min(Math.max(n, 1), max);
}

/**
 * Safely coerce a value to a bounded string. Trims whitespace, enforces
 * min/max length. Returns null if invalid or out of bounds.
 *
 * Use this for any free-form user input that goes into URLs, queries,
 * or persisted rows — never pass raw req.body.foo to a SQL query.
 * Defence against oversized payloads (Express body limit is 1kb globally
 * but individual fields can still be pathological within that).
 */
export function safeParseString(
  value: unknown,
  minLen: number,
  maxLen: number
): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length < minLen || trimmed.length > maxLen) return null;
  return trimmed;
}

/**
 * Strict hex check — for TX hashes, blob hashes, private-key inputs, etc.
 * Rejects anything containing non-hex characters or wrong length.
 */
export function isHexOfLength(value: unknown, length: number): value is string {
  return (
    typeof value === "string" &&
    value.length === length &&
    /^[0-9a-fA-F]+$/.test(value)
  );
}
