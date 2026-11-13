/**
 * Which account `GET /api/vault/nfts` may publish as the prize account.
 *
 * The page that shows this address invites people to send things to it, so it
 * must never be an account whose loss would cost more than its prizes:
 *
 *   1. Never the server's own signing account. That key is hot, and the same
 *      account holds the NFT collection's minter badge (STATE.md, Disclosures).
 *   2. Never an account holding a known custody badge (the minter badge, or any
 *      badge recorded in deploy-state.json), whatever key controls it.
 *
 * Both checks fail closed: if the signer cannot be derived, deploy-state.json
 * cannot be read, or the account's holdings cannot be read in full, the address
 * is not published.
 */

import { getSignerAccountAddresses, readDeployStateStrict } from "./signer";
import type { AccountHoldings } from "./gateway";

export type TreasuryRefusal =
  | "is_signer"
  | "signer_unknown"
  | "custody_badges_unknown"
  | "holds_custody_badge"
  | "holdings_incomplete";

/**
 * Resource addresses of every custody badge this server knows about:
 * `NFT_MINTER_BADGE`, plus any value in deploy-state.json stored under a key
 * containing "badge" (owner, admin and minter badges written by the deploy
 * scripts, including the retired v1 vaults' tombstones). Read per call.
 *
 * Throws when deploy-state.json cannot be read: the badges it records are then
 * unknown, and checking only the minter badge would under-report.
 */
export function knownCustodyBadges(readDeployState: () => unknown = readDeployStateStrict): Set<string> {
  const badges = new Set<string>();
  const minter = (process.env.NFT_MINTER_BADGE || "").trim();
  if (minter) badges.add(minter);

  const walk = (node: unknown, key: string) => {
    if (typeof node === "string") {
      if (/badge/i.test(key) && node.startsWith("resource_")) badges.add(node);
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, k);
    }
  };
  walk(readDeployState(), "");
  return badges;
}

/** Step 1, no network: is this address the signer's own account? */
export async function refuseIfSigner(treasury: string): Promise<TreasuryRefusal | null> {
  try {
    const signer = await getSignerAccountAddresses();
    return signer.includes(treasury) ? "is_signer" : null;
  } catch {
    return "signer_unknown";
  }
}

/** Step 2, after a Gateway read of the account: does it hold a custody badge? */
export function refuseIfHoldsCustodyBadge(
  holdings: AccountHoldings,
  readDeployState: () => unknown = readDeployStateStrict,
): TreasuryRefusal | null {
  let badges: Set<string>;
  try {
    badges = knownCustodyBadges(readDeployState);
  } catch {
    return "custody_badges_unknown";
  }
  if (holdings.resourceAddresses.some((r) => badges.has(r))) return "holds_custody_badge";
  // A badge could sit in a part of the holdings we could not read. Unproven is not safe.
  if (holdings.incomplete) return "holdings_incomplete";
  return null;
}
