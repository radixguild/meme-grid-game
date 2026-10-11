/**
 * Required-env validation.
 *
 * Env loading itself happens in `./load-env` as a side-effect module,
 * imported by `./sentry` (which must run before express for
 * auto-instrumentation) and re-imported here so this file is safe to
 * use in contexts that didn't go through sentry.ts (e.g. tests).
 *
 * Missing required env fails at boot with a named list, not mid-request
 * with a cryptic "server misconfigured" 500.
 */

import "./load-env";

// ── Required-var validation ─────────────────────────────────────────

/**
 * Declare which env vars each subsystem needs. Validation runs at boot
 * and lists every missing var at once (instead of dying on the first).
 *
 * Per-subsystem grouping lets us gate features: if NFT vars are missing
 * we disable the mint worker rather than failing to boot.
 */
export interface RequiredEnvCheck {
  /** Missing vars blocking the server from booting at all */
  fatal: string[];
  /** Missing vars that disable optional features (logged, not fatal) */
  optional: Record<string, string[]>;
}

const CORE_REQUIRED = [
  "RADIX_NETWORK", // mainnet | stokenet
];

const SIGNING_REQUIRED = [
  "BOT_PRIVATE_KEY",
  "RADIX_MAINNET_ADDRESS", // or RADIX_STOKENET_ADDRESS depending on network
];

const ROLA_REQUIRED = [
  "RADIX_MAINNET_DAPP_DEF", // or RADIX_STOKENET_DAPP_DEF
  "ROLA_ALLOWED_ORIGINS",
];

// Minting goes straight to the resource, not through the NFT component — see
// buildMintManifest for why the component can't mint. NFT_COMPONENT is not
// required (and is unused by the mint path).
const NFT_MINTER_REQUIRED = [
  "NFT_RESOURCE",
  "NFT_MINTER_BADGE",
];

function checkPresent(names: string[]): string[] {
  return names.filter((n) => !process.env[n]);
}

/**
 * The network this SERVER process was actually booted with — the only
 * source of truth for it. Returns null when RADIX_NETWORK is unset, so a
 * caller can render "unknown" instead of guessing a default that looks
 * configured.
 *
 * Do NOT read NEXT_PUBLIC_NETWORK here or in any server-side code path.
 * That is a Next.js build-time FRONTEND var — written to .env.local, never
 * to server/.env or secrets.env — so on every real deployment it is simply
 * absent from this process's env. A server-side fallback to it (or to a
 * hardcoded "mainnet") reports whatever the fallback says regardless of
 * which network the server is actually pointed at.
 */
export function getNetwork(): string | null {
  const raw = (process.env.RADIX_NETWORK || "").trim().toLowerCase();
  return raw || null;
}

export function validateEnv(): RequiredEnvCheck {
  const network = getNetwork() ?? "";
  const isMainnet = network === "mainnet";

  // Swap which address/dApp-def key is required based on network
  const signingRequired = SIGNING_REQUIRED.map((k) =>
    k === "RADIX_MAINNET_ADDRESS" && !isMainnet ? "RADIX_STOKENET_ADDRESS" : k
  );
  const rolaRequired = ROLA_REQUIRED.map((k) =>
    k === "RADIX_MAINNET_DAPP_DEF" && !isMainnet ? "RADIX_STOKENET_DAPP_DEF" : k
  );

  const fatal = checkPresent(CORE_REQUIRED);

  const optional: Record<string, string[]> = {};
  const missingSigning = checkPresent(signingRequired);
  if (missingSigning.length) optional["signing (vault claims, NFT mints)"] = missingSigning;

  const missingRola = checkPresent(rolaRequired);
  if (missingRola.length) optional["ROLA auth (proof-of-ownership sessions)"] = missingRola;

  const missingNft = checkPresent(NFT_MINTER_REQUIRED);
  if (missingNft.length) optional["NFT mint worker"] = missingNft;

  return { fatal, optional };
}

/**
 * Log the env check result at startup. Exits the process if any fatal
 * vars are missing. Returns disabled-feature names so callers can skip
 * their init.
 */
export function applyEnvCheck(): { disabledFeatures: string[] } {
  const result = validateEnv();

  if (result.fatal.length > 0) {
    console.error(
      "[config] ✖ FATAL — required env missing:",
      result.fatal.join(", ")
    );
    console.error("[config]   set them in .env or secrets.env and restart.");
    process.exit(1);
  }

  const disabled: string[] = [];
  for (const [feature, missing] of Object.entries(result.optional)) {
    console.warn(
      `[config] ⚠ ${feature} disabled — missing: ${missing.join(", ")}`
    );
    disabled.push(feature);
  }

  if (disabled.length === 0) {
    console.log("[config] ✓ all env groups present");
  }

  return { disabledFeatures: disabled };
}
