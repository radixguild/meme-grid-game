/**
 * auth/purge.ts — the purge that keeps auth_challenges and auth_sessions bounded
 * (MG-5). Before it, both purgeExpired() functions existed with no caller.
 */
process.env.DB_PATH = ":memory:";

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { getDb, closeDb } from "../../db/connection";
import { runMigrations } from "../../db/migrations/runner";
import { issue, consume } from "../challenge";
import { issueSession, lookupSession } from "../session";
import { purgeAuthTables, startAuthPurge } from "../purge";
import { MAINNET_ACCOUNTS } from "../../__tests__/fixtures/addresses";

describe("auth purge", () => {
  before(() => runMigrations(getDb()));
  after(() => closeDb());

  it("deletes expired challenges and sessions and keeps live ones", () => {
    const freshC = issue();
    const oldC = issue();
    getDb().prepare("UPDATE auth_challenges SET expires_at = 1 WHERE challenge = ?").run(oldC.challenge);
    const liveS = issueSession({ radix_address: MAINNET_ACCOUNTS[0] });
    const deadS = issueSession({ radix_address: MAINNET_ACCOUNTS[0] });
    getDb().prepare("UPDATE auth_sessions SET expires_at = 1 WHERE token = ?").run(deadS.token);

    const r = purgeAuthTables();
    assert.equal(r.challenges, 1);
    assert.equal(r.sessions, 1);
    assert.equal(consume(freshC.challenge), true);
    assert.ok(lookupSession(liveS.token));
  });

  it("startAuthPurge purges immediately and returns an unref'd interval", () => {
    const old = issue();
    getDb().prepare("UPDATE auth_challenges SET expires_at = 1 WHERE challenge = ?").run(old.challenge);
    const timer = startAuthPurge(60_000);
    try {
      const left = getDb().prepare("SELECT COUNT(*) AS n FROM auth_challenges WHERE challenge = ?").get(old.challenge) as {
        n: number;
      };
      assert.equal(left.n, 0);
      assert.equal(timer.hasRef(), false);
    } finally {
      clearInterval(timer);
    }
  });

  it("never throws when a purge fails — reports null instead", () => {
    getDb().exec("ALTER TABLE auth_sessions RENAME TO auth_sessions_gone");
    try {
      const r = purgeAuthTables();
      assert.equal(r.sessions, null);
      assert.equal(typeof r.challenges, "number");
    } finally {
      getDb().exec("ALTER TABLE auth_sessions_gone RENAME TO auth_sessions");
    }
  });

  it("the server entry point starts the purge at boot", () => {
    // index.ts boots a listener when imported, so pin the wiring by source.
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "index.ts"), "utf8");
    assert.match(src, /^import \{ startAuthPurge \} from "\.\/auth\/purge";$/m);
    assert.match(src, /^startAuthPurge\(\);$/m);
  });
});
