/**
 * The ROLLS price, read from the DEPLOYED VAULT rather than from a constant.
 *
 * As of vault v2 the rate is component state (`xrd_per_roll`), changeable by the
 * owner via `set_price` without a redeploy. That made `economy.ts`'s `XRD_PER_ROLL`
 * a copy of a number that now lives somewhere else and can move without warning —
 * and `/token/info` was serving the copy while its own client comment claimed the
 * value was "served from the deployed vault's price". economy.ts flagged this
 * itself and deferred it to phase 2: "reading it live from the component on every
 * request is the proper fix and belongs with re-enabling purchases — that is the
 * only time it can be wrong in a way a player would notice." Phase 2 is this deploy.
 *
 * What a stale price actually costs, so the trade-offs below are judged against the
 * real risk rather than an imagined one: the blueprint enforces the true rate, so a
 * wrong quote can never mint ROLLS cheaply. Quote too HIGH and the buyer overpays
 * into `buy_rolls`, which now returns the difference as change. Quote too LOW and
 * the payment buys fewer whole ROLLS than the shop promised, or none at all and the
 * transaction reverts on the blueprint's own minimum check. So the worst case is a
 * confused player and a wasted network fee — bad, not dangerous. That is why every
 * failure path here degrades to a number rather than to an error.
 *
 * Three properties this has to hold:
 *
 *   1. NEVER reject. `/token/info` is the endpoint the whole client bootstraps from;
 *      a Gateway outage must not take the shop's price display down with it. Every
 *      path returns a usable number, and `source` says which one it came from.
 *   2. NEVER hammer the Gateway. `/token/info` is public and unauthenticated, so an
 *      uncached read here would let anyone turn page loads into outbound Gateway
 *      traffic. Cached with a TTL, and concurrent misses share one in-flight call.
 *   3. PREFER a stale on-chain value to the config constant. A price read 10 minutes
 *      ago is closer to the truth than a number compiled in weeks ago, so the cache
 *      is served past its TTL when a refresh fails, and reported as `component-stale`.
 */

import { getEntityDetails } from "./gateway";
import { XRD_PER_ROLL } from "../game/economy";

/**
 * Mirrors MIN/MAX_XRD_PER_ROLL in `scrypto/meme-token/src/lib.rs`, where `set_price`
 * enforces them. A value outside this range cannot have come from the component, so
 * reading one means the response was misparsed — treat it as a failed read, not as a
 * price. Keeping the bound here rather than trusting the input is the same reason the
 * blueprint bounds it rather than trusting the client.
 *
 * ⚠️ These MUST be re-checked against the blueprint whenever its rails move. They sat
 * at 1 / 10,000 after the rails widened to 0.001 / 1,000,000, which inverted the whole
 * point of the guard: a price the owner had legitimately set below 1 would have been
 * read as a misparse, discarded, and silently replaced by the compiled-in fallback —
 * the shop quoting a price the vault had stopped charging, which is exactly what
 * `xrd_per_roll_source` exists to make visible.
 */
export const MIN_XRD_PER_ROLL = 0.001;
export const MAX_XRD_PER_ROLL = 1_000_000;

/** How long a successful read is served before a refresh is attempted. */
const TTL_MS = 60_000;

export type PriceSource = "component" | "component-stale" | "config";

export interface XrdPerRoll {
  value: number;
  /**
   * Where the number came from. Surfaced on `/token/info` deliberately: after the
   * v2 deploy this field is the fastest way to tell whether the live read works,
   * without reading logs. `config` in production means it does not.
   */
  source: PriceSource;
}

/**
 * Pull `xrd_per_roll` out of a Gateway `/state/entity/details` response.
 *
 * Exported because this is the part that can be wrong, and the only part worth
 * testing: the shape below was verified against the live v1 component on mainnet
 * (`component_rdx1czh262wv…tj6lgxy`), which returns
 * `items[0].details.state.fields[] = { field_name, kind, value }` with Decimals as
 * strings. v1 predates this field, so the test fixtures cover both.
 *
 * Returns null for anything it cannot read with confidence — a missing field, an
 * unexpected `kind`, an unparseable value, or a number outside the blueprint's own
 * bounds. Null means "ask again later", never "the price is zero".
 */
export function parseXrdPerRoll(details: unknown): number | null {
  const fields = (details as any)?.items?.[0]?.details?.state?.fields;
  if (!Array.isArray(fields)) return null;

  const field = fields.find((f: any) => f?.field_name === "xrd_per_roll");
  // `kind` is checked, not just presence: reading a Decimal out of a field the
  // Gateway labelled something else would mean the state layout moved under us,
  // and guessing at that point is how a wrong price gets quoted confidently.
  if (!field || field.kind !== "Decimal") return null;

  const value = Number(field.value);
  if (!Number.isFinite(value)) return null;
  if (value < MIN_XRD_PER_ROLL || value > MAX_XRD_PER_ROLL) return null;
  return value;
}

let cache: { value: number; at: number } | null = null;
let inFlight: Promise<number | null> | null = null;
/** Log a Gateway failure on the way INTO the failing state, not once per request. */
let failing = false;

export interface PriceOptions {
  /** Injected in tests. Defaults to the real Gateway call. */
  fetchDetails?: (address: string) => Promise<unknown>;
  /** Injected in tests so TTL expiry can be exercised without waiting. */
  now?: number;
  /** Injected in tests; defaults to `process.env.VAULT_COMPONENT`. */
  component?: string;
}

/**
 * The current XRD-per-ROLL rate. Never rejects — see the header.
 *
 * `server/src/services/__tests__/vault-price.test.ts` pins that totality directly,
 * including the case where the Gateway throws, because the caller
 * (`GET /token/info`) is an express handler and an async rejection there would hang
 * the request rather than fail it.
 */
export async function getXrdPerRoll(opts: PriceOptions = {}): Promise<XrdPerRoll> {
  const component = opts.component ?? process.env.VAULT_COMPONENT ?? "";
  const now = opts.now ?? Date.now();
  const fetchDetails = opts.fetchDetails ?? getEntityDetails;

  // Phase 1: no vault exists to ask. The constant is the only answer there is, and
  // it is the right one — not a degraded fallback.
  if (!component) return { value: XRD_PER_ROLL, source: "config" };

  if (cache && now - cache.at < TTL_MS) {
    return { value: cache.value, source: "component" };
  }

  if (!inFlight) {
    inFlight = Promise.resolve()
      .then(() => fetchDetails(component))
      .then(parseXrdPerRoll)
      .catch((err: unknown) => {
        // Not swallowed: the read failing is the thing an operator needs to know
        // about, since the price on display silently stops tracking the component.
        // Logged on the transition only, so a sustained outage does not flood.
        if (!failing) {
          failing = true;
          console.warn(
            `[vault-price] live price read failed, falling back: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
        return null;
      })
      .finally(() => {
        inFlight = null;
      });
  }

  const fresh = await inFlight;

  if (fresh !== null) {
    if (failing) {
      failing = false;
      console.info("[vault-price] live price read recovered");
    }
    cache = { value: fresh, at: now };
    return { value: fresh, source: "component" };
  }

  // A price the component really had beats a price the repo remembers.
  if (cache) return { value: cache.value, source: "component-stale" };

  return { value: XRD_PER_ROLL, source: "config" };
}

/** Test seam. The cache is module state, so tests must be able to clear it. */
export function __resetVaultPriceCacheForTests(): void {
  cache = null;
  inFlight = null;
  failing = false;
}
