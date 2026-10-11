/**
 * NFT prize-pool resource allowlist (docs/PROJECT-STATE.md Open item 16, step 2).
 *
 * The prize treasury (`NFT_TREASURY_ACCOUNT`) is read straight off the ledger, so
 * anything it holds would otherwise be treated as a "prize" — including, by
 * operator mistake, a custody badge such as a package Owner Badge, whose loss is
 * irreversible. This module is the gate: only resource addresses listed in
 * `NFT_PRIZE_RESOURCE_ALLOWLIST` (comma-separated, used as-is) count as prizes.
 *
 * FAILS CLOSED: unset or empty means NOTHING is an allowed prize resource.
 */

/** Parse `NFT_PRIZE_RESOURCE_ALLOWLIST`. Read per call, not snapshotted at module load. */
export function getPrizeResourceAllowlist(): Set<string> {
  const raw = process.env.NFT_PRIZE_RESOURCE_ALLOWLIST ?? "";
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

export function isAllowedPrizeResource(resourceAddress: string): boolean {
  return getPrizeResourceAllowlist().has(resourceAddress);
}

/** Keep only allowlisted collections, preserving order and leaving items untouched. */
export function filterAllowedPrizeCollections<T extends { resource_address: string }>(
  collections: readonly T[],
): T[] {
  const allowed = getPrizeResourceAllowlist();
  return collections.filter((c) => allowed.has(c.resource_address));
}

/**
 * Throw if any address is not allowlisted, naming every offender.
 *
 * Not called by any route yet: no on-chain draw/raffle transfer exists in this
 * repo. Per docs/PROJECT-STATE.md item 16's Order of work (dedicated vault →
 * allowlist → auth → stock → enable), any future Phase-2 draw/transfer code MUST
 * call this on every resource it is about to move BEFORE building a transfer
 * manifest.
 */
export function assertAllowedPrizeResources(resourceAddresses: string[]): void {
  const allowed = getPrizeResourceAllowlist();
  const disallowed = resourceAddresses.filter((a) => !allowed.has(a));
  if (disallowed.length > 0) {
    throw new Error(
      `Resource(s) not in NFT_PRIZE_RESOURCE_ALLOWLIST, refusing to treat as prizes: ${disallowed.join(", ")}`,
    );
  }
}
