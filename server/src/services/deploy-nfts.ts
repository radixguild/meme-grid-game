#!/usr/bin/env npx tsx
/**
 * Deploy MemeGridNfts — publish NFT package + instantiate on Radix.
 *
 * Usage:
 *   RADIX_NETWORK=mainnet BOT_KEY_TYPE=ed25519 npx tsx src/services/deploy-nfts.ts
 *
 * Prerequisites:
 *   - WASM + RPD built: cd scrypto/meme-nfts && scrypto build
 *   - BOT_PRIVATE_KEY + account address set
 *
 * Writes addresses to server/deploy-state.json under "nfts" key.
 */

import path from "path";
import fs from "fs";
import dotenv from "dotenv";

// This project's own files ONLY — never another project's secrets (see
// config/load-env.ts). MEME GRID is standalone and must not read
// /opt/<deploy-root>/** (another project's deploy root)
// or ~/.secrets/**.
for (const f of [
  path.join(__dirname, "../../secrets.env"),
  path.join(__dirname, "../../.env"),
]) {
  if (fs.existsSync(f)) dotenv.config({ path: f, override: false });
}

import {
  signAndSubmit, signAndSubmitWithBlobs, waitForCommit, getCommittedDetails,
  loadDeployState, saveDeployState, blobHash, rpdToManifestValue,
  NETWORK_NAME, IS_MAINNET, ACCOUNT, DASHBOARD_URL,
} from "./signer";

// No fallback: the old default here was the GUILD's dApp definition
// ("Radix Guild"), so a deploy with the var unset silently branded MEME GRID
// assets as the guild's and let the guild's dApp def claim them on-chain.
// Fail closed — an unset dApp def must stop the deploy, not guess.
const DAPP_DEF = IS_MAINNET
  ? requireDappDef("RADIX_MAINNET_DAPP_DEF")
  : (process.env.RADIX_STOKENET_DAPP_DEF || process.env.RADIX_STOKENET_ADDRESS || ACCOUNT);

function requireDappDef(varName: string): string {
  const v = process.env[varName];
  if (!v) {
    throw new Error(
      `${varName} is not set. Set MEME GRID's own dApp definition account — ` +
        `never the guild's (account_rdx12yh4fw…78z9sq). Deploying with the ` +
        `guild's dApp def makes it the on-chain claimant of this game's assets.`
    );
  }
  return v;
}

// ── Step 1: Publish package ─────────────────────────────────────────────────

async function publishPackage(): Promise<string> {
  const buildDir = path.join(__dirname, "../../../scrypto/build");
  const targetDir = path.join(__dirname, "../../../scrypto/target/wasm32-unknown-unknown/release");

  let wasmPath = path.join(buildDir, "meme_nfts.wasm");
  let rpdPath = path.join(buildDir, "meme_nfts.rpd");

  if (!fs.existsSync(wasmPath)) {
    wasmPath = path.join(targetDir, "meme_nfts.wasm");
    rpdPath = path.join(targetDir, "meme_nfts.rpd");
  }

  if (!fs.existsSync(wasmPath)) {
    console.error("  ❌ WASM not found. Run: cd scrypto/meme-nfts && scrypto build");
    console.error("     Checked:", buildDir, "and", targetDir);
    process.exit(1);
  }

  const wasmBytes = fs.readFileSync(wasmPath);
  const rpdBytes = fs.readFileSync(rpdPath);
  const wasmBlobHash = blobHash(wasmBytes);
  const packageDefinition = await rpdToManifestValue(rpdBytes);

  console.log(`  📦 WASM: ${(wasmBytes.length / 1024).toFixed(1)}KB  hash: ${wasmBlobHash.slice(0, 16)}...`);
  console.log(`  📋 RPD:  ${(rpdBytes.length / 1024).toFixed(1)}KB → ${packageDefinition.length} char manifest Tuple`);

  const manifest = `
PUBLISH_PACKAGE_ADVANCED
  Enum<OwnerRole::None>()
  ${packageDefinition}
  Blob("${wasmBlobHash}")
  Map<String, Tuple>()
  None;
`.trim();

  const intentHash = await signAndSubmitWithBlobs(manifest, [wasmBytes]);
  const result = await waitForCommit(intentHash);

  if (!result.success) {
    console.error("  ❌ Package publish failed");
    console.log("  Status:", JSON.stringify(result.status, null, 2));
    process.exit(1);
  }

  const details = await getCommittedDetails(intentHash);
  const entities: string[] = details.transaction?.affected_global_entities || [];
  const prefix = IS_MAINNET ? "package_rdx1" : "package_tdx_2_";
  const packageAddress = entities.find((e: string) => e.startsWith(prefix));

  if (!packageAddress) {
    console.error("  ❌ Could not find package address");
    console.log("  Entities:", entities);
    process.exit(1);
  }

  console.log(`  ✅ Package: ${packageAddress}`);
  saveDeployState({ nfts: { packageAddress, publishTx: intentHash } });
  return packageAddress;
}

// ── Step 2: Instantiate NFT component ───────────────────────────────────────

async function instantiateNfts(packageAddress: string) {
  console.log(`\n  🏗️  Instantiating MemeGridNfts...`);

  const manifest = `
CALL_FUNCTION
  Address("${packageAddress}")
  "MemeGridNfts"
  "instantiate"
  Address("${DAPP_DEF}");

CALL_METHOD
  Address("${ACCOUNT}")
  "deposit_batch"
  Expression("ENTIRE_WORKTOP");
`.trim();

  const intentHash = await signAndSubmit(manifest);
  const result = await waitForCommit(intentHash);

  if (!result.success) {
    console.error("  ❌ Instantiation failed");
    console.log("  Status:", JSON.stringify(result.status, null, 2));
    process.exit(1);
  }

  const details = await getCommittedDetails(intentHash);
  const entities: string[] = details.transaction?.affected_global_entities || [];

  const compPrefix = IS_MAINNET ? "component_rdx1" : "component_tdx_2_";
  const resPrefix = IS_MAINNET ? "resource_rdx1" : "resource_tdx_2_";

  const componentAddress = entities.find((e: string) => e.startsWith(compPrefix));
  const resourceAddresses = entities.filter((e: string) => e.startsWith(resPrefix));

  if (!componentAddress) {
    console.error("  ❌ No component address found");
    console.log("  Entities:", entities);
    process.exit(1);
  }

  // Resources created: owner_badge (0), minter_badge (1), nft_resource (2)
  const ownerBadge = resourceAddresses[0] || "unknown";
  const minterBadge = resourceAddresses[1] || "unknown";
  const nftResource = resourceAddresses[2] || "unknown";

  console.log(`  ✅ Component:     ${componentAddress}`);
  console.log(`  🔑 Owner Badge:   ${ownerBadge}`);
  console.log(`  🏭 Minter Badge:  ${minterBadge}`);
  console.log(`  🎨 NFT Resource:  ${nftResource}`);
  console.log(`  🔗 ${DASHBOARD_URL}/transaction/${intentHash}`);

  const state = loadDeployState();
  saveDeployState({
    nfts: {
      ...state.nfts,
      componentAddress,
      ownerBadge,
      minterBadge,
      nftResource,
      instantiateTx: intentHash,
    },
  });

  return { componentAddress, ownerBadge, minterBadge, nftResource };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Deploy MEME GRID NFT Collection");
  console.log(`  Network: ${NETWORK_NAME.toUpperCase()}`);
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Account: ${ACCOUNT}`);
  console.log(`  dApp:    ${DAPP_DEF}`);

  if (!ACCOUNT) {
    console.error("\n  ❌ No account address set");
    process.exit(1);
  }

  const state = loadDeployState();
  const nft = state.nfts || {};

  let packageAddress = nft.packageAddress;
  if (packageAddress) {
    console.log(`\n  ↩️  Reusing existing package: ${packageAddress}`);
  } else {
    console.log("\n  📦 Publishing MemeGridNfts package...");
    packageAddress = await publishPackage();
  }

  const componentAddress = nft.componentAddress;
  if (componentAddress) {
    console.log(`\n  ↩️  Reusing existing component: ${componentAddress}`);
  } else {
    await instantiateNfts(packageAddress);
  }

  const final = loadDeployState().nfts;
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  ✅ MEME GRID NFTs deployed!\n");
  console.log(`  NFT_COMPONENT=${final.componentAddress}`);
  console.log(`  NFT_RESOURCE=${final.nftResource}`);
  console.log(`  NFT_MINTER_BADGE=${final.minterBadge}`);
  console.log(`  NFT_OWNER_BADGE=${final.ownerBadge}`);
  console.log("\n  Minter badge is in deployer account.`");
  console.log("  Game server needs proof of minter badge to mint NFTs.");
  console.log("\n  Addresses saved to server/deploy-state.json");
  console.log("═══════════════════════════════════════════════════\n");
}

main().catch(err => {
  console.error(`\n  💥 FATAL: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
