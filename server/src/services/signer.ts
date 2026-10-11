/**
 * Transaction signer — builds, signs, and submits Radix transactions.
 * Adapted from the operator's earlier private Radix signer implementations.
 *
 * SECURITY: private key loaded from env, never logged or returned.
 */

import { TransactionBuilder, PrivateKey, NetworkId, RadixEngineToolkit, ManifestSborStringRepresentation, hash as blake2b256 } from "@radixdlt/radix-engine-toolkit";
import fs from "fs";
import path from "path";
import { getDb } from "../db/connection";

// ── Network config ──────────────────────────────────────────────────────────

const NETWORK_NAME = process.env.RADIX_NETWORK || "stokenet";
const IS_MAINNET = NETWORK_NAME === "mainnet";
const NETWORK = IS_MAINNET ? NetworkId.Mainnet : NetworkId.Stokenet;

const GATEWAY_URL = IS_MAINNET
  ? "https://mainnet.radixdlt.com"
  : "https://stokenet.radixdlt.com";

const DASHBOARD_URL = IS_MAINNET
  ? "https://dashboard.radixdlt.com"
  : "https://stokenet-dashboard.radixdlt.com";

const XRD = IS_MAINNET
  ? "resource_rdx1tknxxxxxxxxxradxrdxxxxxxxxx009923554798xxxxxxxxxradxrd"
  : "resource_tdx_2_1tknxxxxxxxxxradxrdxxxxxxxxx009923554798xxxxxxxxxtfd2jc";

// Account address — mainnet and stokenet stored separately
const ACCOUNT = IS_MAINNET
  ? (process.env.RADIX_MAINNET_ADDRESS || process.env.RADIX_ACCOUNT_ADDRESS || "")
  : (process.env.RADIX_STOKENET_ADDRESS || process.env.RADIX_ACCOUNT_ADDRESS || "");

// ── Deploy state ────────────────────────────────────────────────────────────

const DEPLOY_STATE_PATH = path.join(__dirname, "../../deploy-state.json");

export function loadDeployState(): Record<string, any> {
  try { return JSON.parse(fs.readFileSync(DEPLOY_STATE_PATH, "utf8")); }
  catch { return {}; }
}

export function saveDeployState(updates: Record<string, any>): Record<string, any> {
  const current = loadDeployState();
  const merged = { ...current, ...updates, _updated: new Date().toISOString() };
  fs.writeFileSync(DEPLOY_STATE_PATH, JSON.stringify(merged, null, 2));
  return merged;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function getCurrentEpoch(): Promise<number> {
  const res = await fetch(`${GATEWAY_URL}/status/gateway-status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`Gateway status error: ${res.status}`);
  const data = await res.json();
  return (data as any).ledger_state?.epoch ?? 1;
}

function getPrivateKey(): any {
  const hex = process.env.BOT_PRIVATE_KEY;
  if (!hex) throw new Error("BOT_PRIVATE_KEY not set in env");
  // Pad to even hex length (Secp256k1 keys can be 63 chars)
  const padded = hex.length % 2 !== 0 ? "0" + hex : hex;
  const keyType = (process.env.BOT_KEY_TYPE || "secp256k1").toLowerCase();
  return keyType === "ed25519"
    ? new PrivateKey.Ed25519(padded)
    : new PrivateKey.Secp256k1(padded);
}

function withLockFee(manifest: string, fee = "10"): string {
  if (manifest.trimStart().includes("lock_fee")) return manifest;
  return `CALL_METHOD\n  Address("${ACCOUNT}")\n  "lock_fee"\n  Decimal("${fee}");\n\n${manifest}`;
}

// ── Custody assertion ───────────────────────────────────────────────────────

async function deriveSignerAddress(): Promise<string> {
  try {
    return await RadixEngineToolkit.Derive.virtualAccountAddressFromPublicKey(
      getPrivateKey().publicKey(),
      NETWORK
    );
  } catch (err: any) {
    console.error(`[signer] ✖ FATAL — cannot derive an address from BOT_PRIVATE_KEY: ${err?.message ?? err}`);
    console.error(`[signer]   check BOT_KEY_TYPE (currently "${process.env.BOT_KEY_TYPE || "secp256k1"}") and the key encoding.`);
    process.exit(1);
  }
}

/**
 * Prove that BOT_PRIVATE_KEY actually controls the configured account.
 *
 * A configured address states an *intention*; only derivation proves custody.
 * This project has been bitten twice by trusting it: RADIX_MAINNET_ADDRESS once
 * named an account the server held no key for, and on 2026-07-19 the NFT minter
 * badge was moved to a new account without the key being swapped to match. Both
 * were silent until a transaction failed on-chain. Boot is the cheap place to
 * find out instead.
 *
 * A wrong key is a misconfiguration rather than an absent feature, so this
 * exits rather than degrading: every signed transaction would fail auth anyway,
 * and continuing is how the last two incidents stayed invisible. When signing
 * is simply unconfigured (no key or no address) this no-ops — validateEnv
 * already reports that as a disabled feature and gameplay runs fine without it.
 */
export async function assertSignerCustody(): Promise<void> {
  if (!process.env.BOT_PRIVATE_KEY || !ACCOUNT) return;

  const derived = await deriveSignerAddress();
  const addressVar = IS_MAINNET ? "RADIX_MAINNET_ADDRESS" : "RADIX_STOKENET_ADDRESS";

  if (derived !== ACCOUNT) {
    console.error("[signer] ✖ FATAL — BOT_PRIVATE_KEY does not control the configured account.");
    console.error(`[signer]   ${addressVar} = ${ACCOUNT}`);
    console.error(`[signer]   key derives to = ${derived}`);
    console.error("[signer]   every signed transaction would fail auth. Fix the key or the address, then restart.");
    process.exit(1);
  }

  // The treasury holds prizes and the minter badge. It may legitimately be a
  // wallet the server cannot sign for (gift-only), so a mismatch warns rather
  // than blocks — but it does mean no automated withdrawal from it can work.
  const treasury = process.env.NFT_TREASURY_ACCOUNT;
  if (treasury && treasury !== derived) {
    console.warn("[signer] ⚠ NFT_TREASURY_ACCOUNT is not the signing account —");
    console.warn(`[signer]   treasury = ${treasury}`);
    console.warn(`[signer]   signer   = ${derived}`);
    console.warn("[signer]   the server cannot move anything out of that treasury.");
  }

  console.log(`[signer] ✓ custody verified — signing as ${derived}`);
}

export function blobHash(bytes: Buffer | Uint8Array): string {
  // Buffer.from() accepts Uint8Array directly — the Object.values() detour
  // was fragile (would break if blake2b256's return shape changed slightly).
  return Buffer.from(blake2b256(new Uint8Array(bytes))).toString("hex");
}

export async function rpdToManifestValue(rpdBytes: Buffer | Uint8Array): Promise<string> {
  return RadixEngineToolkit.ManifestSbor.decodeToString(
    rpdBytes,
    NETWORK,
    ManifestSborStringRepresentation.ManifestString
  );
}

// ── Idempotency + persistent tracking ───────────────────────────────────────

class DuplicateTransactionError extends Error {
  public existingHash: string;
  constructor(intentHash: string, detail?: string) {
    super(`Duplicate transaction: already tracked as ${intentHash}${detail ? ` (${detail})` : ""}`);
    this.name = "DuplicateTransactionError";
    this.existingHash = intentHash;
  }
}

function computeManifestHash(manifest: string): string {
  return Buffer.from(blake2b256(new TextEncoder().encode(manifest))).toString("hex");
}

/**
 * Statuses that mean "an intent for this manifest landed, or still might".
 * `recovered` is orphan recovery's word for committed, so it blocks too — it
 * used to fall through to "allow retry".
 */
const BLOCKING_STATUSES = new Set(["committed", "recovered", "pending", "submitted"]);

/** Gateway intent statuses that prove an intent can never commit. */
const DEFINITIVELY_NOT_COMMITTED = new Set(["CommittedFailure", "PermanentlyRejected"]);

/** One Gateway /transaction/status read. Throws on an HTTP or network failure. */
async function pollIntentStatusOnce(intentHash: string): Promise<string> {
  const res = await fetch(`${GATEWAY_URL}/transaction/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent_hash: intentHash }),
  });
  if (!res.ok) throw new Error(`Gateway status error: ${res.status}`);
  const data: any = await res.json();
  return String(data?.intent_status ?? data?.status ?? "Unknown");
}

/**
 * Refuse to sign a manifest again while an earlier intent for it may still land.
 *
 * ⚠️ DOUBLE-SEND HAZARD (MG-6, 2026-10-06). `timeout` used to mean "allow retry".
 * But waitForCommit gives up after 90s while the intent stays valid for 500
 * epochs, so a timed-out intent can still commit. A retry signs the SAME manifest
 * with a NEW nonce — a second, independent transaction. For today's NFT mints the
 * duplicate local id makes the second one abort on-chain; for any transfer
 * manifest (a Phase 2 claim, faucet or prize payout) both would commit: a double
 * payout. So a `timeout` row now re-polls the Gateway first, and a retry goes
 * ahead only when the earlier intent is provably dead (CommittedFailure /
 * PermanentlyRejected). A Gateway that cannot be read, or any other status,
 * keeps the manifest blocked — fail closed.
 */
async function checkManifestIdempotency(
  manifestHash: string,
  pollIntent: (intentHash: string) => Promise<string> = pollIntentStatusOnce
): Promise<void> {
  const db = getDb();
  const existing = db.prepare(
    "SELECT intent_hash, status FROM transactions WHERE manifest_hash = ? ORDER BY submitted_at DESC, id DESC LIMIT 1"
  ).get(manifestHash) as { intent_hash: string; status: string } | undefined;

  if (!existing) return;

  if (BLOCKING_STATUSES.has(existing.status)) {
    throw new DuplicateTransactionError(existing.intent_hash);
  }

  if (existing.status === "timeout") {
    let intentStatus: string;
    try {
      intentStatus = await pollIntent(existing.intent_hash);
    } catch (err: any) {
      throw new DuplicateTransactionError(
        existing.intent_hash,
        `timed out earlier and its status cannot be read now: ${err?.message ?? err}`
      );
    }
    if (intentStatus === "CommittedSuccess") {
      updateTransactionStatus(existing.intent_hash, "committed");
      throw new DuplicateTransactionError(existing.intent_hash, "timed out earlier, has since committed");
    }
    if (DEFINITIVELY_NOT_COMMITTED.has(intentStatus)) {
      updateTransactionStatus(existing.intent_hash, "failed", intentStatus);
      return; // the earlier intent can never land — a retry is safe
    }
    throw new DuplicateTransactionError(
      existing.intent_hash,
      `timed out earlier and is still ${intentStatus} — not retryable until it resolves`
    );
  }
  // failed — allow retry
}

function persistTransaction(intentHash: string, manifestHash: string, purpose: string): void {
  const db = getDb();
  db.prepare(
    "INSERT OR IGNORE INTO transactions (intent_hash, manifest_hash, purpose, status) VALUES (?, ?, ?, 'submitted')"
  ).run(intentHash, manifestHash, purpose);
}

function updateTransactionStatus(intentHash: string, status: string, errorDetail?: string): void {
  // HIGH-3: observe DB failures loudly instead of swallowing them. We don't
  // re-throw because the TX's on-chain reality is unaffected by our local
  // bookkeeping, and orphan recovery (runs 120s later) will reconcile any
  // divergence by re-polling the gateway. Throwing here would break the
  // happy-path callers in waitForCommit and cause worse cascading failures.
  try {
    const db = getDb();
    const resolvedAt = Math.floor(Date.now() / 1000);
    if (errorDetail) {
      db.prepare(
        "UPDATE transactions SET status = ?, resolved_at = ?, error_detail = ? WHERE intent_hash = ?"
      ).run(status, resolvedAt, errorDetail, intentHash);
    } else {
      db.prepare(
        "UPDATE transactions SET status = ?, resolved_at = ? WHERE intent_hash = ?"
      ).run(status, resolvedAt, intentHash);
    }
  } catch (err: any) {
    console.error(
      `[signer] DB update failed for ${intentHash} -> ${status}: ${err?.message ?? err}`,
      err?.stack ?? ""
    );
    // intentionally do NOT re-throw — orphan recovery is the safety net
  }
}

/**
 * Recover transactions orphaned by a previous server shutdown.
 * Polls status for any pending/submitted/timeout TXs older than 120 seconds.
 * `timeout` is included because a timed-out intent can still commit (see
 * checkManifestIdempotency); it was never re-polled before.
 */
export async function recoverOrphanedTransactions(): Promise<void> {
  const db = getDb();
  const cutoff = Math.floor(Date.now() / 1000) - 120;
  const orphaned = db.prepare(
    "SELECT intent_hash FROM transactions WHERE status IN ('pending', 'submitted', 'timeout') AND submitted_at < ?"
  ).all(cutoff) as { intent_hash: string }[];

  if (orphaned.length === 0) return;

  console.log(`[signer] Recovering ${orphaned.length} orphaned transactions...`);
  let committed = 0, failed = 0, stillPending = 0;

  for (const row of orphaned) {
    try {
      const result = await waitForCommit(row.intent_hash, 30_000);
      if (result.success) {
        updateTransactionStatus(row.intent_hash, "recovered");
        committed++;
      } else {
        const statusStr = result.status?.status || "unknown";
        if (statusStr === "Timeout") {
          stillPending++;
        } else {
          updateTransactionStatus(row.intent_hash, "failed", statusStr);
          failed++;
        }
      }
    } catch (err: any) {
      // Full stack to logs so silent recovery failures don't vanish.
      // Defensive string conversion — some errors don't have .message.
      const msg = err?.message ? String(err.message) : String(err);
      console.error(`[signer] Recovery failed for ${row.intent_hash}: ${msg}`, err?.stack ?? "");
      updateTransactionStatus(row.intent_hash, "failed", msg.slice(0, 200));
      failed++;
    }
  }

  console.log(`[signer] Processed ${orphaned.length} orphaned transactions (${committed} committed, ${failed} failed, ${stillPending} still pending)`);
}

export { DuplicateTransactionError, checkManifestIdempotency };

// ── Core TX functions ───────────────────────────────────────────────────────

async function buildAndSign(manifest: string, blobs: Array<Buffer | Uint8Array> = []): Promise<{ hex: string; intentHash: string }> {
  if (!ACCOUNT) throw new Error("No account address — set RADIX_STOKENET_ADDRESS or RADIX_ACCOUNT_ADDRESS");
  const pk = getPrivateKey();
  const epoch = await getCurrentEpoch();

  const blobsForToolkit = blobs.map(b => new Uint8Array(b));

  const builder = await TransactionBuilder.new();
  const notarized = await builder
    .header({
      networkId: NETWORK,
      startEpochInclusive: epoch,
      endEpochExclusive: epoch + 500,
      nonce: Math.floor(Math.random() * 0xFFFFFFFF),
      notaryPublicKey: pk.publicKey(),
      notaryIsSignatory: true,
      tipPercentage: 0,
    })
    .manifest({ instructions: { kind: "String", value: manifest }, blobs: blobsForToolkit })
    .notarize(pk);

  const compiled = await RadixEngineToolkit.NotarizedTransaction.compile(notarized);
  const hex = Buffer.from(compiled).toString("hex");
  const hashResult = await RadixEngineToolkit.NotarizedTransaction.intentHash(notarized);
  return { hex, intentHash: hashResult.id };
}

/**
 * Sign and submit a manifest (auto-prepends lock_fee if missing).
 */
export async function signAndSubmit(manifest: string, purpose = "general"): Promise<string> {
  const prepared = withLockFee(manifest);
  const manifestHash = computeManifestHash(prepared);
  await checkManifestIdempotency(manifestHash);

  const { hex, intentHash } = await buildAndSign(prepared);
  // Persist tracking is best-effort — a DB glitch shouldn't block submission
  // of an already-signed transaction. Log but continue.
  try {
    persistTransaction(intentHash, manifestHash, purpose);
  } catch (err: any) {
    console.error(`[signer] Failed to persist ${intentHash} (continuing): ${err?.message ?? err}`);
  }
  console.log(`[signer] Submitting: ${intentHash}`);

  // HIGH-2: if submit fails (network error or HTTP rejection) we must mark
  // the TX as `failed` so retries aren't blocked by the idempotency check.
  // Otherwise the TX stays `submitted` forever until orphan recovery runs.
  try {
    const res = await fetch(`${GATEWAY_URL}/transaction/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notarized_transaction_hex: hex }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Submit failed: ${JSON.stringify(data)}`);
    if ((data as any).duplicate) console.log("[signer] Duplicate TX (already submitted)");
  } catch (err: any) {
    try {
      updateTransactionStatus(
        intentHash,
        "failed",
        `submit_error: ${err?.message ?? String(err)}`.slice(0, 200)
      );
    } catch (dbErr: any) {
      console.error(`[signer] Could not mark ${intentHash} failed: ${dbErr?.message ?? dbErr}`);
    }
    throw err;
  }
  return intentHash;
}

/**
 * Sign and submit with WASM blobs (for package deployment).
 * Uses 100 XRD lock fee (package deploy costs ~27+ XRD in finalization).
 */
export async function signAndSubmitWithBlobs(manifest: string, blobs: Array<Buffer | Uint8Array>, purpose = "deploy"): Promise<string> {
  const prepared = withLockFee(manifest, "100");
  // Idempotency based on manifest text only (excluding blobs)
  const manifestHash = computeManifestHash(prepared);
  await checkManifestIdempotency(manifestHash);

  const { hex, intentHash } = await buildAndSign(prepared, blobs);
  try {
    persistTransaction(intentHash, manifestHash, purpose);
  } catch (err: any) {
    console.error(`[signer] Failed to persist ${intentHash} (continuing): ${err?.message ?? err}`);
  }
  console.log(`[signer] Submitting (with blobs): ${intentHash}`);

  // HIGH-2: same failure-marking pattern as signAndSubmit above.
  try {
    const res = await fetch(`${GATEWAY_URL}/transaction/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ notarized_transaction_hex: hex }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`Submit failed: ${JSON.stringify(data)}`);
    if ((data as any).duplicate) console.log("[signer] Duplicate TX (already submitted)");
  } catch (err: any) {
    try {
      updateTransactionStatus(
        intentHash,
        "failed",
        `submit_error: ${err?.message ?? String(err)}`.slice(0, 200)
      );
    } catch (dbErr: any) {
      console.error(`[signer] Could not mark ${intentHash} failed: ${dbErr?.message ?? dbErr}`);
    }
    throw err;
  }
  return intentHash;
}

/**
 * Poll for transaction commitment.
 */
export async function waitForCommit(intentHash: string, maxWaitMs = 90_000): Promise<{ success: boolean; status: any }> {
  const start = Date.now();
  let attempts = 0;

  while (Date.now() - start < maxWaitMs) {
    attempts++;
    const res = await fetch(`${GATEWAY_URL}/transaction/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent_hash: intentHash }),
    });
    const data: any = await res.json();
    const status = data.status || data.intent_status || "Unknown";
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    process.stdout.write(`  [${elapsed}s] attempt ${attempts}: ${status}          \r`);

    if (status === "CommittedSuccess") {
      console.log(`\n[signer] Committed: ${intentHash}`);
      updateTransactionStatus(intentHash, "committed");
      return { success: true, status: data };
    }
    if (["CommittedFailure", "Rejected", "PermanentlyRejected"].includes(status)) {
      console.log(`\n[signer] TX failed: ${status}`);
      updateTransactionStatus(intentHash, "failed", status);
      return { success: false, status: data };
    }
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log(`\n[signer] Timeout after ${maxWaitMs / 1000}s`);
  updateTransactionStatus(intentHash, "timeout");
  return { success: false, status: { status: "Timeout" } };
}

/**
 * Get committed transaction details (affected entities, state changes).
 */
export async function getCommittedDetails(intentHash: string): Promise<any> {
  const res = await fetch(`${GATEWAY_URL}/transaction/committed-details`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      intent_hash: intentHash,
      opt_ins: { affected_global_entities: true, receipt_state_changes: true },
    }),
  });
  if (!res.ok) throw new Error(`Committed details failed: ${res.status}`);
  return res.json();
}

// ── Exports for use in other modules ────────────────────────────────────────

export {
  NETWORK_NAME, IS_MAINNET, NETWORK, GATEWAY_URL, DASHBOARD_URL, XRD, ACCOUNT,
  getCurrentEpoch,
};
