process.env.DB_PATH = ":memory:";

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { getDb, closeDb } from "../../connection";
import {
  creditRolls,
  recordCreditOnly,
  getCreditHistory,
  getCreditTotalsBySource,
  hasCredit,
} from "../roll-credits";
import { MAINNET_ACCOUNTS } from "../../../__tests__/fixtures/addresses";

const ADDR = MAINNET_ACCOUNTS[0];
const OTHER = "account_rdx12945s526fxx2c6faj3pykzl6jgl90mhwtnnsgp773r3rp37cstq4lx";

function setupSchema() {
  const db = getDb();
  db.exec("DROP TABLE IF EXISTS roll_credits");
  db.exec("DROP TABLE IF EXISTS players");
  db.exec(`
    CREATE TABLE players (
      radix_address TEXT PRIMARY KEY,
      meme_balance INTEGER DEFAULT 0,
      total_meme_deposited INTEGER DEFAULT 0
    );
  `);
  db.exec(`
    CREATE TABLE roll_credits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      radix_address TEXT NOT NULL,
      amount INTEGER NOT NULL,
      source TEXT NOT NULL,
      source_ref TEXT,
      note TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      CHECK (length(source) > 0),
      CHECK (amount <> 0)
    );
    CREATE UNIQUE INDEX idx_roll_credits_addr_source_ref_unique
      ON roll_credits(radix_address, source, source_ref) WHERE source_ref IS NOT NULL;
  `);
  db.prepare("INSERT INTO players (radix_address, meme_balance) VALUES (?, 0)").run(ADDR);
}

const balance = (addr: string = ADDR): number =>
  (getDb().prepare("SELECT meme_balance AS b FROM players WHERE radix_address = ?").get(addr) as
    | { b: number }
    | undefined)?.b ?? -1;

describe("roll_credits ledger", () => {
  beforeEach(setupSchema);
  after(closeDb);

  it("credits the balance and records the ledger row together", () => {
    const r = creditRolls({ address: ADDR, amount: 25, source: "guild_task", sourceRef: "task-1" });
    assert.equal(r.applied, true);
    assert.equal(balance(), 25);
    assert.equal(getCreditHistory(ADDR).length, 1);
  });

  // The property that makes the guild link safe to wire: a replayed task-completion
  // event, a re-submitted tx hash or a re-used promo code must never mint twice.
  it("is idempotent on (radix_address, source, source_ref) — a replay credits nothing", () => {
    assert.equal(creditRolls({ address: ADDR, amount: 25, source: "guild_task", sourceRef: "task-1" }).applied, true);

    const replay = creditRolls({ address: ADDR, amount: 25, source: "guild_task", sourceRef: "task-1" });
    assert.equal(replay.applied, false);
    assert.equal(replay.reason, "already credited");

    assert.equal(balance(), 25, "balance must not move on a replay");
    assert.equal(getCreditHistory(ADDR).length, 1, "no second ledger row");
  });

  it("scopes uniqueness to the source, so the same ref under a different source is fine", () => {
    assert.equal(creditRolls({ address: ADDR, amount: 5, source: "guild_task", sourceRef: "abc" }).applied, true);
    assert.equal(creditRolls({ address: ADDR, amount: 7, source: "purchase", sourceRef: "abc" }).applied, true);
    assert.equal(balance(), 12);
  });

  // The 013 re-scope: refs that are naturally shared across players (daily.ts
  // uses the check-in DATE) must be independent grants per player. Under 011's
  // global (source, source_ref) index, only the FIRST player each day was
  // credited — everyone else got applied:false while the route reported success.
  it("scopes uniqueness per player, so two players can share a source_ref", () => {
    getDb().prepare("INSERT INTO players (radix_address, meme_balance) VALUES (?, 0)").run(OTHER);

    assert.equal(creditRolls({ address: ADDR, amount: 10, source: "daily", sourceRef: "2026-08-13:meme" }).applied, true);
    assert.equal(creditRolls({ address: OTHER, amount: 10, source: "daily", sourceRef: "2026-08-13:meme" }).applied, true);
    assert.equal(balance(ADDR), 10);
    assert.equal(balance(OTHER), 10);

    // ...while a same-player replay of that ref still credits nothing.
    assert.equal(creditRolls({ address: OTHER, amount: 10, source: "daily", sourceRef: "2026-08-13:meme" }).applied, false);
    assert.equal(balance(OTHER), 10);
  });

  it("leaves unreferenced grants unconstrained (partial index)", () => {
    for (let i = 0; i < 3; i++) {
      assert.equal(creditRolls({ address: ADDR, amount: 10, source: "promo" }).applied, true);
    }
    assert.equal(balance(), 30);
    assert.equal(getCreditHistory(ADDR).length, 3);
  });

  // creditMemeBalance is a bare UPDATE: crediting an address with no player row
  // silently did nothing while the caller reported success.
  it("does not record a credit it could not deliver", () => {
    const r = creditRolls({ address: OTHER, amount: 50, source: "promo", sourceRef: "p-1" });
    assert.equal(r.applied, false);
    assert.equal(r.playerExists, false);
    assert.equal(getCreditHistory(OTHER).length, 0, "ledger row must be rolled back");
    // ...and the ref stays free, so a real retry can still succeed later.
    assert.equal(hasCredit("promo", "p-1"), false);
  });

  it("rejects zero and non-integer amounts", () => {
    assert.equal(creditRolls({ address: ADDR, amount: 0, source: "promo" }).applied, false);
    assert.equal(creditRolls({ address: ADDR, amount: 1.5, source: "promo" }).applied, false);
    assert.equal(balance(), 0);
  });

  it("supports negative amounts so spends can be ledgered later without migration", () => {
    creditRolls({ address: ADDR, amount: 100, source: "promo", sourceRef: "seed" });
    assert.equal(creditRolls({ address: ADDR, amount: -30, source: "refund", sourceRef: "r-1" }).applied, true);
    assert.equal(balance(), 70);
  });

  it("answers revenue-vs-giveaway in one query", () => {
    creditRolls({ address: ADDR, amount: 500, source: "free_start", sourceRef: ADDR });
    creditRolls({ address: ADDR, amount: 100, source: "purchase", sourceRef: "txid_a" });
    creditRolls({ address: ADDR, amount: 40, source: "purchase", sourceRef: "txid_b" });
    creditRolls({ address: ADDR, amount: 7, source: "guild_task", sourceRef: "task-9" });

    const totals = getCreditTotalsBySource();
    const bySource = Object.fromEntries(totals.map((t) => [t.source, t.total]));
    assert.equal(bySource.purchase, 140);
    assert.equal(bySource.free_start, 500);
    assert.equal(bySource.guild_task, 7);
    assert.equal(totals.find((t) => t.source === "purchase")?.credits, 2);
  });

  it("recordCreditOnly reports a duplicate rather than throwing", () => {
    assert.equal(recordCreditOnly({ address: ADDR, amount: 10, source: "purchase", sourceRef: "txid_x" }), true);
    assert.equal(recordCreditOnly({ address: ADDR, amount: 10, source: "purchase", sourceRef: "txid_x" }), false);
    assert.equal(balance(), 0, "recordCreditOnly must not move the balance");
  });
});
