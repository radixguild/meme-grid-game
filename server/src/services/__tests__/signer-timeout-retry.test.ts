/**
 * A timed-out transaction is not retryable until the Gateway says it is dead
 * (MG-6). Drives the REAL checkManifestIdempotency and recoverOrphanedTransactions
 * from services/signer.ts against an in-memory DB, with the Gateway injected or
 * fetch stubbed — no network.
 *
 * Why it matters: waitForCommit gives up after 90s but the intent stays valid for
 * 500 epochs. Retrying signs the same manifest with a new nonce, which for any
 * transfer manifest is a second payout if the first one also lands.
 */
process.env.DB_PATH = ":memory:";
process.env.RADIX_NETWORK = "stokenet";

import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { getDb, closeDb } from "../../db/connection";
import { runMigrations } from "../../db/migrations/runner";
import {
  checkManifestIdempotency,
  recoverOrphanedTransactions,
  DuplicateTransactionError,
} from "../signer";

const MANIFEST_HASH = "mh_timeout_test";
const INTENT = "txid_tdx_2_1timeouttest";

function insertTx(status: string, intent = INTENT, submittedAt = Math.floor(Date.now() / 1000) - 600) {
  getDb()
    .prepare(
      "INSERT INTO transactions (intent_hash, manifest_hash, purpose, status, submitted_at) VALUES (?, ?, 'test', ?, ?)"
    )
    .run(intent, MANIFEST_HASH, status, submittedAt);
}

const statusOf = (intent = INTENT): string | undefined =>
  (getDb().prepare("SELECT status FROM transactions WHERE intent_hash = ?").get(intent) as { status: string } | undefined)
    ?.status;

const poller = (answer: string | Error) => {
  const calls: string[] = [];
  const fn = async (hash: string) => {
    calls.push(hash);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fn, calls };
};

describe("signer: a timed-out intent blocks a retry until it provably failed", () => {
  before(() => runMigrations(getDb()));
  beforeEach(() => getDb().exec("DELETE FROM transactions"));
  after(() => closeDb());

  it("blocks while the Gateway still reports the intent as pending", async () => {
    insertTx("timeout");
    const p = poller("Pending");
    await assert.rejects(checkManifestIdempotency(MANIFEST_HASH, p.fn), DuplicateTransactionError);
    assert.deepEqual(p.calls, [INTENT], "the timed-out intent must be re-polled");
    assert.equal(statusOf(), "timeout");
  });

  it("blocks and records committed when the timed-out intent has since landed", async () => {
    insertTx("timeout");
    await assert.rejects(
      checkManifestIdempotency(MANIFEST_HASH, poller("CommittedSuccess").fn),
      /has since committed/
    );
    assert.equal(statusOf(), "committed");
  });

  for (const dead of ["CommittedFailure", "PermanentlyRejected"]) {
    it(`allows a retry once the intent is ${dead}`, async () => {
      insertTx("timeout");
      await checkManifestIdempotency(MANIFEST_HASH, poller(dead).fn);
      assert.equal(statusOf(), "failed");
    });
  }

  for (const unsure of ["Unknown", "LikelyButNotCertainRejection", "Rejected", "CommitPendingOutcomeUnknown"]) {
    it(`keeps blocking on the non-definitive status ${unsure}`, async () => {
      insertTx("timeout");
      await assert.rejects(checkManifestIdempotency(MANIFEST_HASH, poller(unsure).fn), DuplicateTransactionError);
      assert.equal(statusOf(), "timeout");
    });
  }

  it("fails closed when the Gateway cannot be read", async () => {
    insertTx("timeout");
    await assert.rejects(
      checkManifestIdempotency(MANIFEST_HASH, poller(new Error("Gateway status error: 503")).fn),
      /cannot be read now/
    );
    assert.equal(statusOf(), "timeout");
  });

  it("blocks a manifest whose last intent was recovered (= committed via orphan recovery)", async () => {
    insertTx("recovered");
    const p = poller("CommittedSuccess");
    await assert.rejects(checkManifestIdempotency(MANIFEST_HASH, p.fn), DuplicateTransactionError);
    assert.equal(p.calls.length, 0);
  });

  it("still allows a retry after a plain failure, without polling", async () => {
    insertTx("failed");
    const p = poller("Pending");
    await checkManifestIdempotency(MANIFEST_HASH, p.fn);
    assert.equal(p.calls.length, 0);
  });

  it("judges by the most recent intent for the manifest", async () => {
    const now = Math.floor(Date.now() / 1000);
    insertTx("failed", "txid_old", now - 900);
    insertTx("timeout", "txid_new", now - 900); // same second: id breaks the tie
    await assert.rejects(checkManifestIdempotency(MANIFEST_HASH, poller("Pending").fn), /txid_new/);
  });
});

describe("signer: orphan recovery re-polls timed-out intents", () => {
  before(() => runMigrations(getDb()));
  beforeEach(() => getDb().exec("DELETE FROM transactions"));
  after(() => closeDb());

  it("resolves a 'timeout' row the Gateway now reports committed", async (t) => {
    insertTx("timeout");
    const seen: string[] = [];
    t.mock.method(globalThis, "fetch", async (url: string, init: { body: string }) => {
      seen.push(`${url} ${init.body}`);
      return new Response(JSON.stringify({ status: "CommittedSuccess", intent_status: "CommittedSuccess" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });
    await recoverOrphanedTransactions();
    assert.equal(seen.length, 1);
    assert.match(seen[0], /\/transaction\/status/);
    assert.match(seen[0], new RegExp(INTENT));
    assert.equal(statusOf(), "recovered");
  });
});
