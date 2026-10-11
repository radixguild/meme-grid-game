process.env.DB_PATH = ":memory:";

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { getDb, closeDb } from "../../db/connection";
import {
  issueSession,
  lookupSession,
  revokeSession,
  revokeAllForAddress,
  purgeExpired,
  SESSION_TTL_SEC,
} from "../session";
import { MAINNET_ACCOUNTS } from "../../__tests__/fixtures/addresses";

function setupSchema() {
  const db = getDb();
  db.exec("DROP TABLE IF EXISTS auth_sessions");
  db.exec(`
    CREATE TABLE auth_sessions (
      token TEXT PRIMARY KEY,
      radix_address TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      user_agent TEXT,
      origin TEXT,
      revoked_at INTEGER
    );
  `);
}

const ADDR = MAINNET_ACCOUNTS[0];

describe("auth_sessions", () => {
  beforeEach(setupSchema);
  after(closeDb);

  it("issues a session with a 64-hex-char token and a future expiry", () => {
    const s = issueSession({ radix_address: ADDR, userAgent: "test" });
    assert.match(s.token, /^[0-9a-f]{64}$/);
    assert.equal(s.radix_address, ADDR);
    const now = Math.floor(Date.now() / 1000);
    assert.ok(s.expires_at > now);
    assert.ok(s.expires_at <= now + SESSION_TTL_SEC + 1);
  });

  it("lookupSession returns the row for valid tokens only", () => {
    const s = issueSession({ radix_address: ADDR });
    assert.ok(lookupSession(s.token));
    assert.equal(lookupSession("garbage"), null);
    assert.equal(lookupSession(""), null);

    getDb()
      .prepare("UPDATE auth_sessions SET expires_at = 0 WHERE token = ?")
      .run(s.token);
    assert.equal(lookupSession(s.token), null);
  });

  it("revokeSession prevents future lookup", () => {
    const s = issueSession({ radix_address: ADDR });
    assert.equal(revokeSession(s.token), true);
    assert.equal(lookupSession(s.token), null);
    assert.equal(revokeSession(s.token), false);
  });

  it("revokeAllForAddress scopes to a single address", () => {
    issueSession({ radix_address: ADDR });
    issueSession({ radix_address: ADDR });
    issueSession({ radix_address: "account_rdx1other" });
    assert.equal(revokeAllForAddress(ADDR), 2);
    assert.equal(revokeAllForAddress(ADDR), 0);
  });

  it("purgeExpired removes only dead rows", () => {
    const live = issueSession({ radix_address: ADDR });
    const dead = issueSession({ radix_address: ADDR });
    getDb()
      .prepare("UPDATE auth_sessions SET expires_at = 1 WHERE token = ?")
      .run(dead.token);
    assert.equal(purgeExpired(), 1);
    assert.ok(lookupSession(live.token));
  });
});
