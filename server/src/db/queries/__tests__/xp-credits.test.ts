process.env.DB_PATH = ":memory:";

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { getDb, closeDb } from "../../connection";
import { creditXp, getXpCreditHistory, hasXpCredit } from "../xp-credits";
import { MAINNET_ACCOUNTS } from "../../../__tests__/fixtures/addresses";

const ADDR = MAINNET_ACCOUNTS[0];
const OTHER = "account_rdx12945s526fxx2c6faj3pykzl6jgl90mhwtnnsgp773r3rp37cstq4lx";

function setupSchema() {
  const db = getDb();
  db.exec("DROP TABLE IF EXISTS xp_credits");
  db.exec("DROP TABLE IF EXISTS players");
  db.exec(`
    CREATE TABLE players (
      radix_address TEXT PRIMARY KEY,
      xp INTEGER DEFAULT 0,
      level INTEGER DEFAULT 1
    );
  `);
  db.exec(`
    CREATE TABLE xp_credits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      radix_address TEXT NOT NULL,
      amount INTEGER NOT NULL,
      source TEXT NOT NULL,
      source_ref TEXT,
      note TEXT,
      created_at INTEGER DEFAULT (strftime('%s','now')),
      CHECK (length(source) > 0),
      CHECK (amount > 0)
    );
    CREATE UNIQUE INDEX idx_xp_credits_addr_source_ref_unique
      ON xp_credits(radix_address, source, source_ref) WHERE source_ref IS NOT NULL;
  `);
  db.prepare("INSERT INTO players (radix_address, xp, level) VALUES (?, 0, 1)").run(ADDR);
  db.prepare("INSERT INTO players (radix_address, xp, level) VALUES (?, 0, 1)").run(OTHER);
}

const xp = (addr: string = ADDR): number =>
  (getDb().prepare("SELECT xp AS x FROM players WHERE radix_address = ?").get(addr) as
    | { x: number }
    | undefined)?.x ?? -1;

const level = (addr: string = ADDR): number =>
  (getDb().prepare("SELECT level AS l FROM players WHERE radix_address = ?").get(addr) as
    | { l: number }
    | undefined)?.l ?? -1;

describe("xp_credits ledger", () => {
  beforeEach(setupSchema);
  after(closeDb);

  it("credits xp and records the ledger row together", () => {
    const r = creditXp({ address: ADDR, amount: 50, source: "achievement", sourceRef: "first_grid" });
    assert.equal(r.applied, true);
    assert.equal(r.newXp, 50);
    assert.equal(xp(), 50);
    assert.equal(getXpCreditHistory(ADDR).length, 1);
  });

  // The property the whole seam exists for: an achievement re-unlocking, or a
  // replayed award call, must never mint XP twice — this is the guild's
  // "XP faucet double-credit" bug class, closed here at the ledger level.
  it("is idempotent on (address, source, source_ref) — a replay credits nothing", () => {
    assert.equal(
      creditXp({ address: ADDR, amount: 50, source: "achievement", sourceRef: "first_grid" }).applied,
      true
    );
    const replay = creditXp({ address: ADDR, amount: 50, source: "achievement", sourceRef: "first_grid" });
    assert.equal(replay.applied, false);
    assert.equal(replay.reason, "already credited");
    assert.equal(xp(), 50, "xp must not move on a replay");
    assert.equal(getXpCreditHistory(ADDR).length, 1, "no second ledger row");
  });

  // This is the exact bug class 011_roll_credits.sql has: its unique index is
  // NOT scoped by radix_address, so a source_ref shared across players (e.g.
  // a date) can only ever credit the first player who claims it. xp_credits'
  // index is scoped per-player specifically so this cannot happen here — two
  // different players earning the SAME achievement key must both be credited.
  it("scopes idempotency per player — two players sharing a source_ref both get credited", () => {
    const a = creditXp({ address: ADDR, amount: 50, source: "achievement", sourceRef: "first_grid" });
    const b = creditXp({ address: OTHER, amount: 50, source: "achievement", sourceRef: "first_grid" });
    assert.equal(a.applied, true);
    assert.equal(b.applied, true, "second player must still be credited — this is the 011 bug class");
    assert.equal(xp(ADDR), 50);
    assert.equal(xp(OTHER), 50);
  });

  it("updates level alongside xp using game/levels.ts thresholds", () => {
    const r = creditXp({ address: ADDR, amount: 2000, source: "roll" });
    assert.equal(r.applied, true);
    assert.equal(r.newLevel, 2); // LEVELS[1].xp === 2000 (Lurker)
    assert.equal(r.leveledUp, true);
    assert.equal(level(), 2);
  });

  it("reports leveledUp: false when the credit doesn't cross a threshold", () => {
    const r = creditXp({ address: ADDR, amount: 10, source: "roll" });
    assert.equal(r.leveledUp, false);
    assert.equal(level(), 1);
  });

  it("leaves un-keyed grants (no source_ref) unconstrained", () => {
    for (let i = 0; i < 3; i++) {
      assert.equal(creditXp({ address: ADDR, amount: 5, source: "roll" }).applied, true);
    }
    assert.equal(xp(), 15);
    assert.equal(getXpCreditHistory(ADDR).length, 3);
  });

  it("does not record a credit it could not deliver (no player row)", () => {
    const r = creditXp({ address: "guest_missing", amount: 50, source: "achievement", sourceRef: "x" });
    assert.equal(r.applied, false);
    assert.equal(r.playerExists, false);
    assert.equal(getXpCreditHistory("guest_missing").length, 0, "ledger row must be rolled back");
    assert.equal(hasXpCredit("guest_missing", "achievement", "x"), false);
  });

  it("rejects zero, negative and non-integer amounts", () => {
    assert.equal(creditXp({ address: ADDR, amount: 0, source: "roll" }).applied, false);
    assert.equal(creditXp({ address: ADDR, amount: -5, source: "roll" }).applied, false);
    assert.equal(creditXp({ address: ADDR, amount: 1.5, source: "roll" }).applied, false);
    assert.equal(xp(), 0);
  });

  it("scopes uniqueness to the source, so the same ref under a different source is fine", () => {
    assert.equal(creditXp({ address: ADDR, amount: 10, source: "achievement", sourceRef: "k" }).applied, true);
    assert.equal(creditXp({ address: ADDR, amount: 7, source: "guild_task", sourceRef: "k" }).applied, true);
    assert.equal(xp(), 17);
  });
});
