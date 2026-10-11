/**
 * Tests for transaction idempotency logic (C3) and orphan recovery (HIGH-4).
 *
 * Tests the idempotency decision logic and status tracking without
 * depending on better-sqlite3 native bindings. Uses an in-memory
 * store that mirrors the SQL schema and query semantics.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";

// ── In-memory transaction store (mirrors SQLite schema) ─────────────────────

interface TxRow {
  intent_hash: string;
  manifest_hash: string;
  purpose: string;
  status: string;
  submitted_at: number;
  resolved_at?: number;
  error_detail?: string;
}

let txStore: TxRow[];

function resetStore() {
  txStore = [];
}

// Mirror signer.ts logic

function computeManifestHash(manifest: string): string {
  return createHash("sha256").update(manifest).digest("hex");
}

/**
 * Mirrors checkManifestIdempotency from signer.ts:110-125
 * Returns the blocking row if the manifest is a duplicate of a committed/pending TX,
 * or null if submission is allowed.
 */
function checkManifestIdempotency(manifestHash: string): TxRow | null {
  // Find most recent TX with this manifest hash (ORDER BY submitted_at DESC LIMIT 1)
  const matches = txStore
    .filter((r) => r.manifest_hash === manifestHash)
    .sort((a, b) => b.submitted_at - a.submitted_at);
  const existing = matches[0];

  if (!existing) return null;

  if (existing.status === "committed") return existing;
  if (existing.status === "pending" || existing.status === "submitted") return existing;
  // failed — allow retry. NOT mirrored here: `timeout` and `recovered` (MG-6).
  // The real function now blocks `recovered` and re-polls the Gateway on
  // `timeout`; signer-timeout-retry.test.ts drives the real code for those.
  return null;
}

/**
 * Mirrors persistTransaction from signer.ts:127-132
 * INSERT OR IGNORE — silently skips if intent_hash already exists.
 */
function persistTransaction(intentHash: string, manifestHash: string, purpose: string): void {
  const alreadyExists = txStore.some((r) => r.intent_hash === intentHash);
  if (alreadyExists) return; // INSERT OR IGNORE
  txStore.push({
    intent_hash: intentHash,
    manifest_hash: manifestHash,
    purpose,
    status: "submitted",
    submitted_at: Math.floor(Date.now() / 1000),
  });
}

/**
 * Mirrors updateTransactionStatus from signer.ts:134-146
 */
function updateTransactionStatus(intentHash: string, status: string, errorDetail?: string): void {
  const row = txStore.find((r) => r.intent_hash === intentHash);
  if (!row) return;
  row.status = status;
  row.resolved_at = Math.floor(Date.now() / 1000);
  if (errorDetail) row.error_detail = errorDetail;
}

// ── C3: Idempotency tests ───────────────────────────────────────────────────

describe("C3: Transaction idempotency", () => {
  beforeEach(() => resetStore());

  it("fresh manifest submits successfully (no duplicate)", () => {
    const hash = computeManifestHash("CALL_METHOD lock_fee ...");
    const result = checkManifestIdempotency(hash);
    assert.equal(result, null, "No existing TX — should allow submission");

    // Persist and verify it was stored
    persistTransaction("txid_abc123", hash, "test");
    const row = txStore.find((r) => r.intent_hash === "txid_abc123");
    assert.ok(row);
    assert.equal(row!.status, "submitted");
    assert.equal(row!.purpose, "test");
  });

  it("duplicate of committed TX is rejected", () => {
    const manifest = "CALL_METHOD buy_meme ...";
    const hash = computeManifestHash(manifest);

    // Simulate a committed TX with the same manifest hash
    txStore.push({
      intent_hash: "txid_committed_1",
      manifest_hash: hash,
      purpose: "buy",
      status: "committed",
      submitted_at: Math.floor(Date.now() / 1000) - 60,
    });

    const result = checkManifestIdempotency(hash);
    assert.notEqual(result, null, "Committed TX should block resubmission");
    assert.equal(result!.status, "committed");
    assert.equal(result!.intent_hash, "txid_committed_1");
  });

  it("duplicate of pending TX is rejected", () => {
    const manifest = "CALL_METHOD pending_tx ...";
    const hash = computeManifestHash(manifest);

    txStore.push({
      intent_hash: "txid_pending_1",
      manifest_hash: hash,
      purpose: "mint",
      status: "pending",
      submitted_at: Math.floor(Date.now() / 1000) - 10,
    });

    const result = checkManifestIdempotency(hash);
    assert.notEqual(result, null, "Pending TX should block resubmission");
    assert.equal(result!.status, "pending");
  });

  it("failed TX retry is allowed", () => {
    const manifest = "CALL_METHOD retryable_tx ...";
    const hash = computeManifestHash(manifest);

    txStore.push({
      intent_hash: "txid_failed_1",
      manifest_hash: hash,
      purpose: "faucet",
      status: "failed",
      submitted_at: Math.floor(Date.now() / 1000) - 60,
    });

    const result = checkManifestIdempotency(hash);
    assert.equal(result, null, "Failed TX should allow retry");
  });

  it("persist failure is tolerated as best-effort (INSERT OR IGNORE)", () => {
    const hash = computeManifestHash("CALL_METHOD best_effort ...");

    // First persist
    persistTransaction("txid_dup", hash, "test");
    assert.equal(txStore.length, 1);

    // Duplicate persist — should not throw, should not create second row
    assert.doesNotThrow(() => {
      persistTransaction("txid_dup", hash, "test");
    }, "INSERT OR IGNORE should silently skip duplicates");

    assert.equal(txStore.length, 1, "Should still have exactly one row");
  });
});

// ── HIGH-4: Orphan recovery tests ──────────────────────────────────────────

describe("HIGH-4: Orphan recovery", () => {
  beforeEach(() => resetStore());

  it("stuck pending TX is recovered (committed on-chain)", () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 300; // 5 min ago
    txStore.push({
      intent_hash: "txid_orphan_1",
      manifest_hash: "hash_1",
      purpose: "mint",
      status: "pending",
      submitted_at: oldTimestamp,
    });

    // Simulate recovery: find orphaned TXs (pending/submitted older than 120s)
    const cutoff = Math.floor(Date.now() / 1000) - 120;
    const orphaned = txStore.filter(
      (r) => (r.status === "pending" || r.status === "submitted") && r.submitted_at < cutoff
    );

    assert.equal(orphaned.length, 1);
    assert.equal(orphaned[0].intent_hash, "txid_orphan_1");

    // Simulate: on-chain check returns CommittedSuccess
    updateTransactionStatus("txid_orphan_1", "recovered");

    const row = txStore.find((r) => r.intent_hash === "txid_orphan_1");
    assert.equal(row!.status, "recovered");
    assert.ok(row!.resolved_at, "resolved_at should be set");
  });

  it("stuck pending TX that failed on-chain is marked failed", () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 300;
    txStore.push({
      intent_hash: "txid_orphan_fail",
      manifest_hash: "hash_2",
      purpose: "deploy",
      status: "submitted",
      submitted_at: oldTimestamp,
    });

    // Simulate: on-chain check returns Rejected
    updateTransactionStatus("txid_orphan_fail", "failed", "Rejected");

    const row = txStore.find((r) => r.intent_hash === "txid_orphan_fail");
    assert.equal(row!.status, "failed");
    assert.equal(row!.error_detail, "Rejected");
  });

  it("submit-endpoint timeout is handled (TX marked as timeout)", () => {
    const oldTimestamp = Math.floor(Date.now() / 1000) - 300;
    txStore.push({
      intent_hash: "txid_timeout",
      manifest_hash: "hash_3",
      purpose: "faucet",
      status: "submitted",
      submitted_at: oldTimestamp,
    });

    // Simulate: on-chain polling times out — still pending after maxWaitMs
    updateTransactionStatus("txid_timeout", "timeout");

    const row = txStore.find((r) => r.intent_hash === "txid_timeout");
    assert.equal(row!.status, "timeout");
    assert.ok(row!.resolved_at, "resolved_at should be set on timeout");
  });
});
