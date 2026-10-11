#!/usr/bin/env npx tsx
/**
 * Deploy MemeGameVault **v2** — publish package + instantiate + place badges.
 *
 * Usage:
 *   RADIX_NETWORK=stokenet npx tsx src/services/deploy-meme-token.ts
 *   RADIX_NETWORK=mainnet  npx tsx src/services/deploy-meme-token.ts
 *
 * Prerequisites:
 *   - WASM + RPD built ON LINUX: cd scrypto && cargo build --release --target
 *     wasm32-unknown-unknown  (macOS cannot build these — bulk-memory WASM)
 *   - BOT_PRIVATE_KEY set in this project's server/secrets.env (never a shared
 *     or another project's secrets file — see config/load-env.ts)
 *   - RADIX_STOKENET_ADDRESS or RADIX_MAINNET_ADDRESS set
 *   - Badge destinations set — see "Custody" below. On mainnet these are
 *     mandatory and must be three DISTINCT accounts.
 *
 * ── Custody: why this script refuses to run without three accounts ──────────
 *
 * v1's owner role is immutable, so its ~160 XRD can leave only through a proof of
 * its one owner badge (docs/VAULT-V1-LOST.md). The proximate cause was an
 * `OwnerRole::Fixed`, but the reason it could not be worked around is that ONE
 * badge went wherever the deploy transaction dropped it, and that account's key
 * then went missing (it was found again 2026-09-17 and is held, so the XRD is
 * recoverable; moving the badge to another operator-held account is planned).
 *
 * v2 mints TWO owner badges and a separate admin badge precisely so that cold
 * custody, a backup under different key material, and the warm operations key
 * are three different things. Depositing them all into the deploying account —
 * which is exactly what the old version of this script did with
 * `deposit_batch ENTIRE_WORKTOP` — rebuilds v1's single point of failure while
 * appearing to succeed. So:
 *
 *   VAULT_OWNER_COLD_ACCOUNT    owner badge #1 — cold custody, ideally an
 *                               Access Controller with a recovery role
 *   VAULT_OWNER_BACKUP_ACCOUNT  owner badge #2 — separate key material
 *   VAULT_ADMIN_ACCOUNT         admin badge — the warm operator key that pauses
 *
 * The deployer account holds all three only between step 2 and step 3, and the
 * script verifies on-chain that it holds none of them at the end.
 *
 * Writes addresses to server/deploy-state.json under "memeTokenV2".
 */

import path from "path";
import fs from "fs";
import dotenv from "dotenv";

// Load secrets — this project's own files ONLY, never another project's (see
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
  NETWORK_NAME, IS_MAINNET, ACCOUNT, DASHBOARD_URL, GATEWAY_URL,
} from "./signer";
import { isOnChainAddress } from "../middleware/validate";

/** deploy-state key. Deliberately NOT "memeToken" — see the tombstone note below. */
const STATE_KEY = "memeTokenV2";

// dApp definition for metadata linking.
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

// ── Custody ─────────────────────────────────────────────────────────────────

interface Custody {
  ownerCold: string;
  ownerBackup: string;
  admin: string;
}

/**
 * Resolve the three badge destinations, or refuse to deploy.
 *
 * On mainnet all three are required and must be distinct — a repeated address
 * is not a configuration shortcut, it is the v1 failure mode with extra steps. On
 * stokenet they default to the deployer account so the flow can be rehearsed,
 * and the script says loudly that this shape must never reach mainnet.
 */
function resolveCustody(): Custody {
  const cold = process.env.VAULT_OWNER_COLD_ACCOUNT || "";
  const backup = process.env.VAULT_OWNER_BACKUP_ACCOUNT || "";
  const admin = process.env.VAULT_ADMIN_ACCOUNT || "";

  if (!IS_MAINNET) {
    const fallback = ACCOUNT;
    const custody = {
      ownerCold: cold || fallback,
      ownerBackup: backup || fallback,
      admin: admin || fallback,
    };
    if (!cold || !backup || !admin) {
      console.warn(
        "\n  ⚠️  Stokenet: badge destinations default to the deployer account.\n" +
        "     That is v1's single point of failure. Mainnet REQUIRES three distinct\n" +
        "     accounts and this script will refuse to deploy there without them."
      );
    }
    return custody;
  }

  const missing = [
    !cold && "VAULT_OWNER_COLD_ACCOUNT",
    !backup && "VAULT_OWNER_BACKUP_ACCOUNT",
    !admin && "VAULT_ADMIN_ACCOUNT",
  ].filter(Boolean);

  if (missing.length) {
    throw new Error(
      `Mainnet deploy requires badge destinations. Unset: ${missing.join(", ")}.\n` +
      `  v2 mints two owner badges and one admin badge so that cold custody, a\n` +
      `  backup under separate key material, and the warm operations key are three\n` +
      `  different accounts. Deploying without deciding where they go is how v1's\n` +
      `  ~160 XRD got stranded — see docs/VAULT-V1-LOST.md.`
    );
  }

  for (const [name, value] of [
    ["VAULT_OWNER_COLD_ACCOUNT", cold],
    ["VAULT_OWNER_BACKUP_ACCOUNT", backup],
    ["VAULT_ADMIN_ACCOUNT", admin],
  ] as const) {
    if (!isOnChainAddress(value)) {
      throw new Error(`${name}="${value}" is not a valid Radix account address.`);
    }
  }

  const distinct = new Set([cold, backup, admin]);
  if (distinct.size !== 3) {
    throw new Error(
      `The three badge destinations must be DISTINCT accounts — got ${distinct.size}.\n` +
      `  Two owner badges in one wallet is one badge with extra steps, and the\n` +
      `  whole point of the v2 split is that losing one key is survivable.`
    );
  }

  if (distinct.has(ACCOUNT)) {
    throw new Error(
      `A badge destination is the DEPLOYER account (${ACCOUNT}). The deploying key\n` +
      `  is the warm server key — it signs game transactions continuously and is the\n` +
      `  least suitable place for owner authority over the treasury.`
    );
  }

  return { ownerCold: cold, ownerBackup: backup, admin };
}

// ── Gateway reads ───────────────────────────────────────────────────────────

async function entityDetails(addresses: string[]): Promise<any[]> {
  const res = await fetch(`${GATEWAY_URL}/state/entity/details`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ addresses, aggregation_level: "Global" }),
  });
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { items?: any[] };
  return body.items || [];
}

/**
 * Read the three resource addresses out of the component's own state.
 *
 * The old version picked them out of `affected_global_entities` by index —
 * `[0]` owner, `[1]` MEME. v2 creates the admin badge between those two, so
 * that indexing now silently labels the admin badge as MEME. Ordering in that
 * array was never a documented guarantee in the first place; the component
 * knows the answer, so ask it.
 */
async function resolveEntities(componentAddress: string): Promise<{
  ownerBadge: string; adminBadge: string; memeResource: string;
}> {
  const [item] = await entityDetails([componentAddress]);
  const fields: any[] = item?.details?.state?.fields || [];
  const field = (name: string): string => {
    const f = fields.find((x: any) => x.field_name === name);
    if (!f?.value) {
      throw new Error(
        `Component ${componentAddress} has no "${name}" field. Is this a v2 vault? ` +
        `A v1 component has neither owner_badge_address nor admin_badge_address.`
      );
    }
    return f.value;
  };
  return {
    ownerBadge: field("owner_badge_address"),
    adminBadge: field("admin_badge_address"),
    memeResource: field("rolls_resource_manager"),
  };
}

/**
 * The vault's live `xrd_per_roll`, or null if it cannot be read.
 *
 * Informational only, so it never throws: a Gateway hiccup must not fail a deploy
 * that has already committed its transactions. It is printed because the launch
 * RATE is the one thing about this deploy that is a judgement call rather than a
 * correctness question, and reading it back from the component is the only way to
 * confirm what was actually instantiated. economy.ts has claimed this script
 * prints it for a while; now it does.
 */
async function readOnChainPrice(componentAddress: string): Promise<string | null> {
  try {
    const [item] = await entityDetails([componentAddress]);
    const fields: any[] = item?.details?.state?.fields || [];
    return fields.find((f: any) => f.field_name === "xrd_per_roll")?.value ?? null;
  } catch {
    return null;
  }
}

/** Fungible balance of `resource` held by `account`, as a string amount. */
async function balanceOf(account: string, resource: string): Promise<string> {
  const [item] = await entityDetails([account]);
  const hit = (item?.fungible_resources?.items || [])
    .find((r: any) => r.resource_address === resource);
  return hit?.amount ?? "0";
}

/**
 * Refuse to publish stale or v1 artifacts.
 *
 * `scrypto/build/` is untracked and is preferred over `target/` by the lookup
 * above, so a machine that built v1 months ago has a v1 `meme_token.wasm`
 * sitting exactly where this script looks first. Publishing that as "v2"
 * succeeds — a v1 blueprint is perfectly valid — and the vault is stranded
 * again, having burned the fees to get there.
 *
 * Two independent guards, because either alone is escapable:
 *   - Method and field names survive in the package definition as plain UTF-8, so
 *     a `get_badges` that is absent means this is not the v2 blueprint, and a
 *     `change_returned` that is absent means it predates the fix where `buy_rolls`
 *     stopped keeping the remainder of a non-multiple payment.
 *   - An artifact older than the source it claims to be built from is stale,
 *     even if a previous v2 build made it look right.
 *
 * ⚠️ The two guards are not equally strong, and the content check is the one that
 * matters. Extracting a CI artifact stamps every file with the CURRENT time, so a
 * downloaded build always looks newer than the source and sails past the mtime
 * check no matter which commit produced it. The mtime guard only catches a stale
 * LOCAL build; only the marker strings catch a stale downloaded one.
 */
function assertV2Artifacts(wasmPath: string, rpdPath: string, rpdBytes: Buffer): void {
  const rpdText = rpdBytes.toString("latin1");
  const missing = ["get_badges", "admin_badge_address", "change_returned"]
    .filter(m => !rpdText.includes(m));
  if (missing.length) {
    throw new Error(
      `${rpdPath} is not the v2 blueprint — no ${missing.join(", ")} in the package ` +
      `definition.\n  This is almost certainly a stale v1 artifact. Rebuild on Linux ` +
      `and delete scrypto/build/ first;\n  publishing v1 as v2 produces another ` +
      `stranded vault with an immutable owner role (docs/VAULT-V1-LOST.md).`
    );
  }

  const srcPath = path.join(__dirname, "../../../scrypto/meme-token/src/lib.rs");
  if (fs.existsSync(srcPath)) {
    const srcTime = fs.statSync(srcPath).mtimeMs;
    for (const artifact of [wasmPath, rpdPath]) {
      if (fs.statSync(artifact).mtimeMs < srcTime) {
        throw new Error(
          `${artifact} is older than scrypto/meme-token/src/lib.rs — stale build.\n` +
          `  Rebuild on Linux before deploying.`
        );
      }
    }
  }
}

// ── Step 1: Publish package ─────────────────────────────────────────────────

async function publishPackage(): Promise<string> {
  // Try pre-built artifacts first, then scrypto build output
  const buildDir = path.join(__dirname, "../../../scrypto/build");
  const targetDir = path.join(__dirname, "../../../scrypto/target/wasm32-unknown-unknown/release");

  let wasmPath = path.join(buildDir, "meme_token.wasm");
  let rpdPath = path.join(buildDir, "meme_token.rpd");

  if (!fs.existsSync(wasmPath)) {
    wasmPath = path.join(targetDir, "meme_token.wasm");
    rpdPath = path.join(targetDir, "meme_token.rpd");
  }

  if (!fs.existsSync(wasmPath)) {
    console.error("  ❌ WASM not found. Build on Linux: cd scrypto && scrypto build");
    console.error("     Checked:", buildDir, "and", targetDir);
    process.exit(1);
  }
  if (!fs.existsSync(rpdPath)) {
    console.error("  ❌ RPD not found alongside WASM");
    process.exit(1);
  }

  const wasmBytes = fs.readFileSync(wasmPath);
  const rpdBytes = fs.readFileSync(rpdPath);
  assertV2Artifacts(wasmPath, rpdPath, rpdBytes);
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
    console.error("  ❌ Could not find package address in TX");
    console.log("  Entities:", entities);
    process.exit(1);
  }

  console.log(`  ✅ Package: ${packageAddress}`);
  console.log(`  🔗 ${DASHBOARD_URL}/transaction/${intentHash}`);
  saveDeployState({ [STATE_KEY]: { packageAddress, publishTx: intentHash } });
  return packageAddress;
}

// ── Step 2: Instantiate MemeGameVault ────────────────────────────────────────

async function instantiateVault(packageAddress: string) {
  console.log(`\n  🏗️  Instantiating MemeGameVault v2...`);
  console.log(`     dApp definition: ${DAPP_DEF}`);

  // instantiate returns (component, owner_badges×2, admin_badge). They land in
  // the deployer account here and are moved out in step 3 — a manifest cannot
  // route them directly, because the badge resource addresses do not exist
  // until this transaction commits.
  const manifest = `
CALL_FUNCTION
  Address("${packageAddress}")
  "MemeGameVault"
  "instantiate"
  Address("${DAPP_DEF}");

CALL_METHOD
  Address("${ACCOUNT}")
  "deposit_batch"
  Expression("ENTIRE_WORKTOP");
`.trim();

  const intentHash = await signAndSubmit(manifest, "deploy");
  const result = await waitForCommit(intentHash);

  if (!result.success) {
    console.error("  ❌ Instantiation failed");
    console.log("  Status:", JSON.stringify(result.status, null, 2));
    process.exit(1);
  }

  const details = await getCommittedDetails(intentHash);
  const entities: string[] = details.transaction?.affected_global_entities || [];
  const compPrefix = IS_MAINNET ? "component_rdx1" : "component_tdx_2_";
  const componentAddress = entities.find((e: string) => e.startsWith(compPrefix));

  if (!componentAddress) {
    console.error("  ❌ No component address found");
    console.log("  Entities:", entities);
    process.exit(1);
  }

  const { ownerBadge, adminBadge, memeResource } = await resolveEntities(componentAddress);

  console.log(`  ✅ Component:    ${componentAddress}`);
  console.log(`  🔑 Owner Badge:  ${ownerBadge}  (supply 2)`);
  console.log(`  🛠  Admin Badge:  ${adminBadge}`);
  console.log(`  🪙 MEME Token:   ${memeResource}`);
  console.log(`  🔗 ${DASHBOARD_URL}/transaction/${intentHash}`);

  const state = loadDeployState();
  saveDeployState({
    [STATE_KEY]: {
      ...state[STATE_KEY],
      componentAddress,
      ownerBadge,
      adminBadge,
      memeResource,
      instantiateTx: intentHash,
    },
  });

  return { componentAddress, ownerBadge, adminBadge, memeResource };
}

// ── Step 3: Place the badges ─────────────────────────────────────────────────

async function distributeBadges(
  ownerBadge: string,
  adminBadge: string,
  custody: Custody,
): Promise<void> {
  console.log(`\n  🔐 Placing badges...`);
  console.log(`     owner #1 → ${custody.ownerCold}   (cold)`);
  console.log(`     owner #2 → ${custody.ownerBackup} (backup)`);
  console.log(`     admin    → ${custody.admin}       (warm ops)`);

  // Single transaction: either all three badges land where they belong, or none
  // move and the deployer still holds them for a retry. Splitting this into
  // three transactions would allow a half-placed state that reads as success.
  const manifest = `
CALL_METHOD
  Address("${ACCOUNT}")
  "withdraw"
  Address("${ownerBadge}")
  Decimal("2");

TAKE_FROM_WORKTOP
  Address("${ownerBadge}")
  Decimal("1")
  Bucket("owner_cold");

CALL_METHOD
  Address("${custody.ownerCold}")
  "try_deposit_or_abort"
  Bucket("owner_cold")
  None;

TAKE_FROM_WORKTOP
  Address("${ownerBadge}")
  Decimal("1")
  Bucket("owner_backup");

CALL_METHOD
  Address("${custody.ownerBackup}")
  "try_deposit_or_abort"
  Bucket("owner_backup")
  None;

CALL_METHOD
  Address("${ACCOUNT}")
  "withdraw"
  Address("${adminBadge}")
  Decimal("1");

TAKE_ALL_FROM_WORKTOP
  Address("${adminBadge}")
  Bucket("admin");

CALL_METHOD
  Address("${custody.admin}")
  "try_deposit_or_abort"
  Bucket("admin")
  None;
`.trim();

  const intentHash = await signAndSubmit(manifest, "deploy");
  const result = await waitForCommit(intentHash);

  if (!result.success) {
    console.error("  ❌ Badge placement failed — the badges are still in the deployer account.");
    console.error("     Fix the destinations and re-run; do NOT leave them there.");
    console.log("  Status:", JSON.stringify(result.status, null, 2));
    process.exit(1);
  }

  console.log(`  ✅ Badges placed`);
  console.log(`  🔗 ${DASHBOARD_URL}/transaction/${intentHash}`);
  saveDeployState({
    [STATE_KEY]: { ...loadDeployState()[STATE_KEY], custody, distributeTx: intentHash },
  });
}

/**
 * Verify custody on-chain rather than trusting the manifest committed.
 * A deploy that reports success while the deployer still holds owner authority
 * is the failure this whole redeploy exists to prevent, so it is checked and
 * not assumed.
 */
async function verifyCustody(
  ownerBadge: string,
  adminBadge: string,
  custody: Custody,
): Promise<boolean> {
  const checks: Array<[string, string, string, string]> = [
    ["owner #1 (cold)", custody.ownerCold, ownerBadge, "1"],
    ["owner #2 (backup)", custody.ownerBackup, ownerBadge, "1"],
    ["admin", custody.admin, adminBadge, "1"],
    ["deployer holds no owner badge", ACCOUNT, ownerBadge, "0"],
    ["deployer holds no admin badge", ACCOUNT, adminBadge, "0"],
  ];

  let ok = true;
  console.log(`\n  🔎 Verifying custody on-chain...`);
  for (const [label, account, resource, want] of checks) {
    const got = await balanceOf(account, resource);
    const pass = Number(got) === Number(want);
    if (!pass) ok = false;
    console.log(`     ${pass ? "✅" : "❌"} ${label}: expected ${want}, on-chain ${got}`);
  }
  return ok;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Deploy MEME GRID Token — vault v2");
  console.log(`  Network: ${NETWORK_NAME.toUpperCase()}`);
  console.log("═══════════════════════════════════════════════════");
  console.log(`  Account: ${ACCOUNT}`);
  console.log(`  dApp:    ${DAPP_DEF}`);

  if (!ACCOUNT) {
    console.error("\n  ❌ No account address set. Set RADIX_STOKENET_ADDRESS or RADIX_MAINNET_ADDRESS");
    process.exit(1);
  }

  const custody = resolveCustody();

  const state = loadDeployState();

  // The legacy "memeToken" block records a v1 deployment that is dead and must
  // never be reused — this script deliberately keys off memeTokenV2 instead.
  if (state.memeTokenV1Dead || state.memeToken) {
    console.log(
      "\n  🪦 v1 deployments on record are stranded (owner role" +
      "\n     updater: \"None\"). They are kept in deploy-state.json as tombstones" +
      "\n     only — nothing here reuses them. See docs/VAULT-V1-LOST.md."
    );
  }

  const v2 = state[STATE_KEY] || {};

  // ── Step 1: Publish package ───────────────────────────────────────────────
  let packageAddress = v2.packageAddress;
  if (packageAddress) {
    console.log(`\n  ↩️  Reusing existing v2 package: ${packageAddress}`);
  } else {
    console.log("\n  📦 Publishing MemeGameVault v2 package...");
    packageAddress = await publishPackage();
  }

  // ── Step 2: Instantiate vault ─────────────────────────────────────────────
  let entities: { componentAddress: string; ownerBadge: string; adminBadge: string; memeResource: string };
  if (v2.componentAddress) {
    console.log(`\n  ↩️  Reusing existing v2 component: ${v2.componentAddress}`);
    entities = {
      componentAddress: v2.componentAddress,
      ...(await resolveEntities(v2.componentAddress)),
    };
  } else {
    entities = await instantiateVault(packageAddress);
  }

  // ── Step 3: Place badges (idempotent — skipped once custody verifies) ─────
  if (await verifyCustody(entities.ownerBadge, entities.adminBadge, custody)) {
    console.log("\n  ↩️  Badges already in place.");
  } else {
    await distributeBadges(entities.ownerBadge, entities.adminBadge, custody);
    if (!(await verifyCustody(entities.ownerBadge, entities.adminBadge, custody))) {
      console.error("\n  ❌ Custody verification FAILED after placement. Do not put this");
      console.error("     vault into production until every line above is ✅.");
      process.exit(1);
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  const final = loadDeployState()[STATE_KEY];
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  ✅ MEME GRID vault v2 deployed!\n");
  console.log(`  VAULT_COMPONENT=${final.componentAddress}`);
  console.log(`  MEME_RESOURCE=${final.memeResource}`);
  console.log(`  OWNER_BADGE=${final.ownerBadge}   (supply 2 — cold + backup)`);
  console.log(`  ADMIN_BADGE=${final.adminBadge}`);

  const price = await readOnChainPrice(final.componentAddress);
  if (price) {
    console.log(`\n  RATE: ${price} XRD per ROLL (on-chain, read back from the component)`);
    console.log(`        Change it with set_price and the OWNER badge — no redeploy.`);
  } else {
    console.log(`\n  RATE: could not read xrd_per_roll back from the component.`);
  }
  console.log("\n  Add to your .env:");
  console.log(`  NEXT_PUBLIC_VAULT_COMPONENT=${final.componentAddress}`);
  console.log(`  NEXT_PUBLIC_MEME_RESOURCE=${final.memeResource}`);
  console.log("\n  ⚠️  MEME_RESOURCE is a NEW resource. Player balances are server-side,");
  console.log("      so gameplay is unaffected, but any MEME held on-chain from v1 is a");
  console.log("      different token and does not carry over.");
  console.log("\n  Addresses saved to server/deploy-state.json");
  console.log("═══════════════════════════════════════════════════\n");
}

main().catch(err => {
  console.error(`\n  💥 FATAL: ${err.message}`);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
