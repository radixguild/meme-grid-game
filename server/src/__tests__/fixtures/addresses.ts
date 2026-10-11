/**
 * Valid Radix account addresses for tests.
 *
 * These are REAL addresses in the sense that matters: correct bech32m checksum,
 * account entity type, correct network. Since `validateAddress` started checking
 * the checksum (docs/PROJECT-STATE.md item 14), a made-up string like
 * `account_tdx_2_1` + plausible characters no longer passes — several tests were
 * asserting behaviour using fixtures that could never exist on-ledger, which
 * meant they were not testing the real path.
 *
 * Each is derived from a fixed, obviously-fake Ed25519 public key (all bytes set
 * to N) via `RadixEngineToolkit.Derive.virtualAccountAddressFromPublicKey`.
 * NO PRIVATE KEY EXISTS for any of them — this is address derivation, not key
 * generation, and nothing here can hold or move funds.
 *
 * To regenerate or add more:
 *   node -e "const{RadixEngineToolkit:R,PublicKey:P,NetworkId:N}=require('@radixdlt/radix-engine-toolkit');
 *   (async()=>console.log(await R.Derive.virtualAccountAddressFromPublicKey(
 *     new P.Ed25519(new Uint8Array(32).fill(5)), N.Stokenet)))()"
 *
 * Pick the list matching whatever the test sets `RADIX_NETWORK` to — a mainnet
 * address is now correctly rejected on a stokenet server and vice versa.
 */

/** Valid mainnet accounts (RADIX_NETWORK=mainnet). */
export const MAINNET_ACCOUNTS = [
  "account_rdx128uxu4mkjgen9wxcl5a7lpyu4kcec6vkhsnj4u0kfrv4v6jvk9u5mw",
  "account_rdx12xrauujy40qmtl8j3e27gtrll8r83srq2xqlx7k96aq557u40ljufn",
  "account_rdx129nk0qxypew0addcwqd3gas63x64r840vcajnelc4w7uwgv40mc2td",
  "account_rdx12x4vcumquj08f5lz8w2uc2a45zdftp7n8wrx3050884teuljl5ej7h",
] as const;

/** Valid stokenet accounts (RADIX_NETWORK=stokenet — the default in tests). */
export const STOKENET_ACCOUNTS = [
  "account_tdx_2_128uxu4mkjgen9wxcl5a7lpyu4kcec6vkhsnj4u0kfrv4v6jv923xg5",
  "account_tdx_2_12xrauujy40qmtl8j3e27gtrll8r83srq2xqlx7k96aq557u4uslw6f",
  "account_tdx_2_129nk0qxypew0addcwqd3gas63x64r840vcajnelc4w7uwgv4u54cch",
  "account_tdx_2_12x4vcumquj08f5lz8w2uc2a45zdftp7n8wrx3050884teuljvm5qdd",
] as const;

/**
 * Shape-valid but checksum-INVALID — the exact class of string that used to be
 * accepted and funded. Keep using these to pin the hole shut.
 */
export const FABRICATED_ACCOUNTS = [
  "account_rdx1" + "q".repeat(53),
  // A real address with its final character flipped.
  "account_rdx128uxu4mkjgen9wxcl5a7lpyu4kcec6vkhsnj4u0kfrv4v6jvk9u5mx",
] as const;

/** A valid mainnet address that is NOT an account — right shape, wrong entity. */
export const MAINNET_RESOURCE =
  "resource_rdx1t4trlp2hwzlt60g9g2mfwetlpt62zqg2kxl6hdsmvl7tq63y6sdrl7";
