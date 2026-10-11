/**
 * Radix account address validation — checksum, entity type, and network.
 *
 * `validateAddress` used to accept any string matching
 * `/^account_(rdx|tdx_2_)1[a-z0-9]{40,65}$/`. That is a SHAPE check: no bech32m
 * checksum, so `account_rdx1` followed by 45 arbitrary characters passed. Since
 * `GET /api/game/:address` funds any address it has not seen before, inventing
 * strings was a free-MEME faucet, and every fabricated address that later earned
 * an achievement also entered the NFT mint queue — where it cannot resolve to a
 * real account, so each one burns up to `MAX_ATTEMPTS` of server-funded tx fees.
 * See docs/PROJECT-STATE.md item 14.
 *
 * This closes the *fabricated* half. It does NOT stop someone generating real
 * keypairs offline and deriving valid addresses — nothing off-ledger can, which
 * is why the per-IP quota in queries/starting-balance-grants.ts exists alongside
 * it, and why per-route ROLA (open item 3) is still the real fix.
 *
 * Three things are checked, all from one `decode()`:
 *   1. the bech32m checksum is valid       — kills fabricated strings
 *   2. the entity is an ACCOUNT            — a resource/component/identity address
 *                                            is shaped like an address and is not
 *                                            somewhere a player can be paid
 *   3. the network matches RADIX_NETWORK   — a stokenet address on mainnet is a
 *                                            configuration accident, not a player
 */

import { RadixEngineToolkit, EntityType, NetworkId } from "@radixdlt/radix-engine-toolkit";

/**
 * Entity types a player can actually be, and be paid into.
 *
 * `GlobalAccountLocker` is deliberately absent — it is account-adjacent but is a
 * locker component, not a player's account.
 */
const PLAYER_ACCOUNT_ENTITY_TYPES: ReadonlySet<EntityType> = new Set([
  EntityType.GlobalAccount,
  EntityType.GlobalVirtualSecp256k1Account,
  EntityType.GlobalVirtualEd25519Account,
]);

function expectedNetworkId(): number {
  return (process.env.RADIX_NETWORK || "").toLowerCase() === "mainnet"
    ? NetworkId.Mainnet
    : NetworkId.Stokenet;
}

/**
 * Kill switch. Set `ADDRESS_CHECKSUM_ENFORCE=false` to fall back to the old
 * shape-only behaviour without a redeploy (restart required).
 *
 * This exists because the failure mode of getting this wrong is 400-ing every
 * real player, and the per-IP quota still bounds the faucet on its own. If you
 * ever flip it, say so in PROJECT-STATE — running with it off is running with a
 * known hole open.
 */
function enforcing(): boolean {
  return (process.env.ADDRESS_CHECKSUM_ENFORCE || "true").toLowerCase() !== "false";
}

// Successful validations only. An address that decodes once always decodes, so
// this is a pure win on repeat traffic (most requests are returning players).
// Failures are deliberately NOT cached — that set is attacker-controlled and
// would be an unbounded memory write.
const verified = new Set<string>();
const VERIFIED_CACHE_MAX = 5_000;

/**
 * True if `address` is a real, checksum-valid account on the configured network.
 *
 * Async because the toolkit is WASM-backed: ~59ms once to initialise, then
 * ~0.26ms per call warm and ~0.03ms to reject. At this service's rate limits
 * that is not a meaningful cost, and the cache removes it for repeat players.
 */
export async function isValidAccountAddress(address: string): Promise<boolean> {
  if (!enforcing()) return true; // caller has already applied the shape check
  if (verified.has(address)) return true;

  let decoded: { entityType: EntityType; networkId: number };
  try {
    decoded = await RadixEngineToolkit.Address.decode(address);
  } catch {
    // The toolkit rejects anything that is not a well-formed, checksum-valid
    // address. That is the expected path for a fabricated string.
    return false;
  }

  if (!PLAYER_ACCOUNT_ENTITY_TYPES.has(decoded.entityType)) return false;
  if (decoded.networkId !== expectedNetworkId()) return false;

  if (verified.size >= VERIFIED_CACHE_MAX) {
    // Cheap eviction — drop the oldest insertion. Being wrong here costs one
    // re-validation, not correctness.
    const oldest = verified.values().next().value;
    if (oldest !== undefined) verified.delete(oldest);
  }
  verified.add(address);
  return true;
}

/** Test-only: drop the memoized validations. */
export function resetAddressCacheForTests(): void {
  verified.clear();
}
