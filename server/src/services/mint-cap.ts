/**
 * Daily cap on NFT mint transactions: `NFT_MINT_DAILY_CAP`.
 *
 * Every mint is a transaction paid for by the server's signing account, so the
 * number of mints per day is the number of fees per day. The cap bounds that.
 * It counts mint attempts started per UTC day, retries included (each one is a
 * submitted transaction). When the day's count reaches the cap, the worker
 * claims nothing more; queued mints keep their status and attempt count and go
 * out from the next UTC day, oldest first. Nothing is dropped or marked failed
 * because of the cap.
 *
 * Values:
 *   - a whole number N ≥ 1   → at most N mint attempts per UTC day
 *   - 0                      → mints paused (queue keeps filling)
 *   - unset, on mainnet      → paused, the same as 0. Fails closed: forgetting
 *                              to set it must not mean "no limit" on the
 *                              network where fees are real.
 *   - unset, other networks  → no cap (test networks pay test XRD)
 *   - anything else          → paused, with a warning (fails closed)
 *
 * Read per call, so a test (or a restart with new env) sees the current value.
 */

import { getNetwork } from "../config/env";

export interface MintDailyCap {
  /** Max mint attempts per UTC day; null = no cap. 0 = paused. */
  limit: number | null;
  /** Human-readable reason, for logs. Contains no secret values. */
  describe: string;
}

export function getMintDailyCap(): MintDailyCap {
  const raw = (process.env.NFT_MINT_DAILY_CAP ?? "").trim();
  const isMainnet = getNetwork() === "mainnet";

  if (raw === "") {
    return isMainnet
      ? { limit: 0, describe: "NFT_MINT_DAILY_CAP unset on mainnet: mints paused (queued, none submitted)" }
      : { limit: null, describe: "NFT_MINT_DAILY_CAP unset off mainnet: no daily cap" };
  }
  if (/^\d+$/.test(raw)) {
    const limit = Number(raw);
    if (Number.isSafeInteger(limit)) {
      return limit === 0
        ? { limit: 0, describe: "NFT_MINT_DAILY_CAP=0: mints paused (queued, none submitted)" }
        : { limit, describe: `NFT_MINT_DAILY_CAP=${limit} mint attempts per UTC day` };
    }
  }
  return { limit: 0, describe: "NFT_MINT_DAILY_CAP is not a whole number: mints paused (queued, none submitted)" };
}

/** UTC calendar day, YYYY-MM-DD. */
export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}
