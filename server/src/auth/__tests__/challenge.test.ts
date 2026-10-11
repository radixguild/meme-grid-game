/**
 * Challenge lifecycle tests — issue → consume once → reject on replay.
 *
 * Uses DB_PATH=":memory:" so tests exercise real SQLite semantics without
 * writing to disk. Tables are created inline to match migration 009.
 */

// Point the shared DB connection at an in-memory database before any
// app code is imported. Must happen at top-of-file, before the import
// of `challenge` which loads `connection`.
process.env.DB_PATH = ":memory:";

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { getDb, closeDb } from "../../db/connection";
import { issue, consume, purgeExpired, CHALLENGE_TTL_SEC } from "../challenge";

function setupSchema() {
  const db = getDb();
  db.exec("DROP TABLE IF EXISTS auth_challenges");
  db.exec(`
    CREATE TABLE auth_challenges (
      challenge     TEXT PRIMARY KEY,
      created_at    INTEGER NOT NULL,
      expires_at    INTEGER NOT NULL,
      consumed_at   INTEGER
    );
  `);
}

describe("auth_challenges", () => {
  beforeEach(setupSchema);
  after(closeDb);

  it("issues a unique 64-hex-char challenge with a future expiry", () => {
    const a = issue();
    const b = issue();
    assert.notEqual(a.challenge, b.challenge);
    assert.match(a.challenge, /^[0-9a-f]{64}$/);
    const now = Math.floor(Date.now() / 1000);
    assert.ok(a.expiresAt > now);
    assert.ok(a.expiresAt <= now + CHALLENGE_TTL_SEC + 1);
  });

  it("consumes a valid challenge exactly once (replay rejected)", () => {
    const { challenge } = issue();
    assert.equal(consume(challenge), true);
    assert.equal(consume(challenge), false);
  });

  it("rejects unknown challenges", () => {
    assert.equal(consume("0".repeat(64)), false);
  });

  it("rejects expired challenges", () => {
    const { challenge } = issue();
    getDb()
      .prepare("UPDATE auth_challenges SET expires_at = 0 WHERE challenge = ?")
      .run(challenge);
    assert.equal(consume(challenge), false);
  });

  it("purgeExpired removes only expired rows", () => {
    const fresh = issue();
    const old = issue();
    getDb()
      .prepare("UPDATE auth_challenges SET expires_at = 1 WHERE challenge = ?")
      .run(old.challenge);
    const removed = purgeExpired();
    assert.equal(removed, 1);
    assert.equal(consume(fresh.challenge), true);
  });
});
