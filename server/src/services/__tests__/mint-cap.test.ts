/**
 * NFT_MINT_DAILY_CAP: the mint worker starts at most N mint attempts per UTC
 * day. A mint the cap holds back keeps its queue status and attempt count and
 * goes out on a later day; the cap never marks a mint failed or drops one.
 *
 * Drives claimNextMint() against a fully migrated in-memory DB. Nothing here
 * signs or submits: claimNextMint is the DB half of the worker, before signing.
 */
process.env.DB_PATH = ":memory:";
process.env.RADIX_NETWORK = "mainnet";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getDb, closeDb } from "../../db/connection";
import { runMigrations } from "../../db/migrations/runner";
import { claimNextMint, queueNftMint } from "../nft-minter";
import { getMintDailyCap } from "../mint-cap";
import { MAINNET_ACCOUNTS } from "../../__tests__/fixtures/addresses";

const PLAYER = MAINNET_ACCOUNTS[0];
const DAY_1 = new Date("2026-11-20T23:59:30Z");
const DAY_2 = new Date("2026-11-21T00:00:30Z");

/** Seed N unlocks for PLAYER and queue a mint for each, oldest first. */
function seedQueue(n: number): number[] {
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO players (radix_address) VALUES (?)").run(PLAYER);
  const ids: number[] = [];
  for (let i = 0; i < n; i++) {
    const unlock = db
      .prepare(
        `INSERT INTO nft_unlocks (radix_address, nft_key, nft_name, rarity, unlocked_via)
         VALUES (?, ?, ?, 'common', 'test')`,
      )
      .run(PLAYER, `test_nft_${i}`, `Test NFT ${i}`);
    ids.push(queueNftMint(Number(unlock.lastInsertRowid), PLAYER, `test_nft_${i}`, `Test NFT ${i}`, "common"));
  }
  return ids;
}

function queueRows() {
  return getDb()
    .prepare("SELECT id, status, attempts FROM nft_mint_queue ORDER BY id")
    .all() as Array<{ id: number; status: string; attempts: number }>;
}

function startedOn(day: string): number {
  return (
    (getDb().prepare("SELECT started FROM nft_mint_daily_count WHERE day = ?").get(day) as any)?.started ?? 0
  );
}

describe("getMintDailyCap", () => {
  afterEach(() => {
    delete process.env.NFT_MINT_DAILY_CAP;
    process.env.RADIX_NETWORK = "mainnet";
  });

  it("unset on mainnet pauses mints (fails closed)", () => {
    delete process.env.NFT_MINT_DAILY_CAP;
    assert.equal(getMintDailyCap().limit, 0);
  });

  it("unset off mainnet means no cap", () => {
    delete process.env.NFT_MINT_DAILY_CAP;
    process.env.RADIX_NETWORK = "stokenet";
    assert.equal(getMintDailyCap().limit, null);
  });

  it("reads a whole number, including 0", () => {
    process.env.NFT_MINT_DAILY_CAP = "25";
    assert.equal(getMintDailyCap().limit, 25);
    process.env.NFT_MINT_DAILY_CAP = " 7 ";
    assert.equal(getMintDailyCap().limit, 7);
    process.env.NFT_MINT_DAILY_CAP = "0";
    assert.equal(getMintDailyCap().limit, 0);
  });

  for (const bad of ["-1", "2.5", "ten", "1e3", "99999999999999999999"]) {
    it(`treats ${JSON.stringify(bad)} as paused`, () => {
      process.env.NFT_MINT_DAILY_CAP = bad;
      assert.equal(getMintDailyCap().limit, 0);
    });
  }
});

describe("claimNextMint under NFT_MINT_DAILY_CAP", () => {
  beforeEach(() => {
    closeDb();
    runMigrations(getDb());
    process.env.RADIX_NETWORK = "mainnet";
  });

  afterEach(() => {
    delete process.env.NFT_MINT_DAILY_CAP;
    closeDb();
  });

  it("stops at the cap and leaves the held mint untouched", () => {
    process.env.NFT_MINT_DAILY_CAP = "2";
    const [a, b, c] = seedQueue(3);

    assert.equal(claimNextMint(DAY_1)?.id, a);
    assert.equal(claimNextMint(DAY_1)?.id, b);
    assert.equal(claimNextMint(DAY_1), null, "third mint waits");
    assert.equal(claimNextMint(DAY_1), null, "and keeps waiting the same day");

    assert.deepEqual(queueRows(), [
      { id: a, status: "minting", attempts: 1 },
      { id: b, status: "minting", attempts: 1 },
      { id: c, status: "pending", attempts: 0 },
    ]);
    assert.equal(startedOn("2026-11-20"), 2);
  });

  it("releases held mints on the next UTC day, oldest first", () => {
    process.env.NFT_MINT_DAILY_CAP = "1";
    const [a, b, c] = seedQueue(3);

    assert.equal(claimNextMint(DAY_1)?.id, a);
    assert.equal(claimNextMint(DAY_1), null);
    assert.equal(claimNextMint(DAY_2)?.id, b);
    assert.equal(claimNextMint(DAY_2), null);

    const rows = queueRows();
    assert.equal(rows.find((r) => r.id === c)?.status, "pending");
    assert.equal(rows.filter((r) => r.status === "failed").length, 0, "the cap never marks a mint failed");
    assert.equal(startedOn("2026-11-20"), 1);
    assert.equal(startedOn("2026-11-21"), 1);
  });

  it("counts a retry of a failed mint against the cap", () => {
    process.env.NFT_MINT_DAILY_CAP = "2";
    const [a, b] = seedQueue(2);

    assert.equal(claimNextMint(DAY_1)?.id, a);
    // The attempt failed on-chain; the worker marks it for retry.
    getDb().prepare("UPDATE nft_mint_queue SET status = 'failed' WHERE id = ?").run(a);

    assert.equal(claimNextMint(DAY_1)?.id, a, "oldest row first, retry included");
    assert.equal(claimNextMint(DAY_1), null, "two attempts started: cap reached");
    assert.deepEqual(
      queueRows().find((r) => r.id === b),
      { id: b, status: "pending", attempts: 0 },
    );
  });

  it("unset on mainnet claims nothing and touches nothing", () => {
    delete process.env.NFT_MINT_DAILY_CAP;
    const [a] = seedQueue(1);
    assert.equal(claimNextMint(DAY_1), null);
    assert.deepEqual(queueRows(), [{ id: a, status: "pending", attempts: 0 }]);
    assert.equal(startedOn("2026-11-20"), 0);
  });

  it("0 claims nothing", () => {
    process.env.NFT_MINT_DAILY_CAP = "0";
    seedQueue(1);
    assert.equal(claimNextMint(DAY_1), null);
  });

  it("unset off mainnet claims without a cap", () => {
    delete process.env.NFT_MINT_DAILY_CAP;
    process.env.RADIX_NETWORK = "stokenet";
    const ids = seedQueue(3);
    assert.deepEqual(
      [claimNextMint(DAY_1)?.id, claimNextMint(DAY_1)?.id, claimNextMint(DAY_1)?.id],
      ids,
    );
  });

  it("an empty queue does not count against the cap", () => {
    process.env.NFT_MINT_DAILY_CAP = "1";
    assert.equal(claimNextMint(DAY_1), null);
    assert.equal(startedOn("2026-11-20"), 0);
    const [a] = seedQueue(1);
    assert.equal(claimNextMint(DAY_1)?.id, a);
  });
});
