/**
 * ROLA (Radix Off-Ledger Auth) — server-side proof verification.
 *
 * Thin wrapper over the official `@radixdlt/rola` library. We prefer
 * the upstream implementation over a hand-rolled one because:
 *   - signature + pubkey-on-account verification is security-critical
 *   - Radix maintains it alongside protocol changes (e.g. curve updates)
 *   - audit surface is well understood
 *
 * This module exposes `verifyProof()` returning a plain success/error
 * result (we don't want `neverthrow`'s `ResultAsync` leaking into the
 * rest of the codebase).
 */

import { GatewayApiClient } from "@radixdlt/babylon-gateway-api-sdk";
import { Rola, type SignedChallenge } from "@radixdlt/rola";

export type { SignedChallenge };

// ── Config (computed once at module load) ───────────────────────────

const NETWORK = (process.env.RADIX_NETWORK || "mainnet").toLowerCase();
const IS_MAINNET = NETWORK === "mainnet";
const NETWORK_ID = IS_MAINNET ? 1 : 2;

const GATEWAY_URL =
  process.env.RADIX_GATEWAY_URL ||
  (IS_MAINNET
    ? "https://mainnet.radixdlt.com"
    : "https://stokenet.radixdlt.com");

const DAPP_DEF_ADDRESS = IS_MAINNET
  ? process.env.RADIX_MAINNET_DAPP_DEF || ""
  : process.env.RADIX_STOKENET_DAPP_DEF || "";

const APPLICATION_NAME = process.env.APPLICATION_NAME || "MEME GRID";

// List of origins the server accepts in ROLA proofs. Allows local dev
// alongside production. CSV in env, e.g.:
//   ROLA_ALLOWED_ORIGINS=https://memegrid.radixguild.com,http://localhost:3005
const ALLOWED_ORIGINS = (process.env.ROLA_ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const gatewayApiClient = GatewayApiClient.initialize({
  networkId: NETWORK_ID,
  applicationName: APPLICATION_NAME,
});

// ── Public API ──────────────────────────────────────────────────────

export interface VerifyInput {
  signedChallenge: SignedChallenge;
  /**
   * Origin that the client claims (from its Origin/Referer header or
   * what it sent during the challenge exchange). Must be in the server's
   * allow-list to be accepted — prevents a malicious dApp from reusing
   * a proof generated against a different origin.
   */
  origin: string;
}

export type VerifyResult =
  | { ok: true }
  | { ok: false; reason: string };

export async function verifyProof(input: VerifyInput): Promise<VerifyResult> {
  if (!DAPP_DEF_ADDRESS) {
    return {
      ok: false,
      reason: "server misconfigured: RADIX_MAINNET_DAPP_DEF / RADIX_STOKENET_DAPP_DEF unset",
    };
  }

  if (ALLOWED_ORIGINS.length === 0) {
    return {
      ok: false,
      reason: "server misconfigured: ROLA_ALLOWED_ORIGINS unset",
    };
  }

  if (!ALLOWED_ORIGINS.includes(input.origin)) {
    return {
      ok: false,
      reason: `origin ${input.origin} not in allow-list`,
    };
  }

  const rola = Rola({
    expectedOrigin: input.origin,
    dAppDefinitionAddress: DAPP_DEF_ADDRESS,
    applicationName: APPLICATION_NAME,
    networkId: NETWORK_ID,
    gatewayApiClient,
  });

  const result = await rola.verifySignedChallenge(input.signedChallenge);
  if (result.isErr()) {
    return { ok: false, reason: result.error.reason };
  }
  return { ok: true };
}

export function configSummary() {
  return {
    network: NETWORK,
    networkId: NETWORK_ID,
    gateway: GATEWAY_URL,
    dAppDef: DAPP_DEF_ADDRESS || "(unset)",
    allowedOrigins: ALLOWED_ORIGINS,
    applicationName: APPLICATION_NAME,
  };
}
