/**
 * Server-side Radix transaction manifest builders.
 * Used for: minting NFTs, distributing tokens, faucet XRD sends.
 */

import { ACCOUNT, XRD } from "./signer";

/**
 * Buy MEME tokens from the vault (test helper — normally done client-side via wallet).
 */
export function buyMemeManifest(vaultComponent: string, xrdAmount: string): string {
  return `
CALL_METHOD
  Address("${ACCOUNT}")
  "withdraw"
  Address("${XRD}")
  Decimal("${xrdAmount}");

TAKE_ALL_FROM_WORKTOP
  Address("${XRD}")
  Bucket("xrd_bucket");

CALL_METHOD
  Address("${vaultComponent}")
  "buy_rolls"
  Bucket("xrd_bucket");

CALL_METHOD
  Address("${ACCOUNT}")
  "deposit_batch"
  Expression("ENTIRE_WORKTOP");
`.trim();
}

/**
 * Send XRD from server wallet to a player (faucet).
 */
export function sendXrdManifest(toAccount: string, amount: string): string {
  return `
CALL_METHOD
  Address("${ACCOUNT}")
  "withdraw"
  Address("${XRD}")
  Decimal("${amount}");

TAKE_ALL_FROM_WORKTOP
  Address("${XRD}")
  Bucket("xrd_bucket");

CALL_METHOD
  Address("${toAccount}")
  "try_deposit_or_abort"
  Bucket("xrd_bucket")
  None;
`.trim();
}

/**
 * Send fungible tokens from server wallet to a player (reward distribution).
 */
export function sendTokenManifest(toAccount: string, tokenResource: string, amount: string): string {
  return `
CALL_METHOD
  Address("${ACCOUNT}")
  "withdraw"
  Address("${tokenResource}")
  Decimal("${amount}");

TAKE_ALL_FROM_WORKTOP
  Address("${tokenResource}")
  Bucket("token_bucket");

CALL_METHOD
  Address("${toAccount}")
  "try_deposit_or_abort"
  Bucket("token_bucket")
  None;
`.trim();
}

/**
 * Mint an NFT and deposit to player wallet.
 * Requires admin badge proof on the NFT component.
 */
export function mintNftManifest(
  nftComponent: string,
  adminBadge: string,
  toAccount: string,
  nftId: string,
  name: string,
  description: string,
  rarity: string,
  iconUrl: string,
  gameKey: string,
): string {
  return `
CALL_METHOD
  Address("${ACCOUNT}")
  "create_proof_of_amount"
  Address("${adminBadge}")
  Decimal("1");

CALL_METHOD
  Address("${nftComponent}")
  "mint_nft"
  "${nftId}"
  "${name}"
  "${description}"
  "${rarity}"
  "${iconUrl}"
  "${gameKey}";

CALL_METHOD
  Address("${toAccount}")
  "try_deposit_or_abort"
  Expression("ENTIRE_WORKTOP")
  None;
`.trim();
}
