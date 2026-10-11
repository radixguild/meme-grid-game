process.env.DB_PATH = ":memory:";

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { getDb, closeDb } from "../../db/connection";
import {
  issueGuestId,
  isServerIssuedGuestId,
  isKnownLegacyGuestId,
  isValidGuestId,
  looksLikeGuestId,
  hashIp,
  guestQuotaFor,
  guestQuotaPerIp,
  quotaBucketFor,
  issueGuestIdWithinQuota,
  recordGuestIssue,
  resetGuestSecretCacheForTests,
  GUEST_QUOTA_WINDOW_SEC,
} from "../guest-id";
import { MAINNET_ACCOUNTS } from "../../__tests__/fixtures/addresses";

// Mirrors 015_guest_identity.sql (plus the one players column these functions read).
function setupSchema() {
  const db = getDb();
  db.exec("DROP TABLE IF EXISTS guest_ids");
  db.exec("DROP TABLE IF EXISTS server_secrets");
  db.exec("DROP TABLE IF EXISTS players");
  db.exec(`
    CREATE TABLE server_secrets (
      name TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE guest_ids (
      guest_address TEXT PRIMARY KEY,
      ip_hash TEXT NOT NULL,
      user_agent TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX idx_guest_ids_ip_created ON guest_ids(ip_hash, created_at);
    CREATE TABLE players (radix_address TEXT PRIMARY KEY, meme_balance INTEGER DEFAULT 0);
  `);
  delete process.env.GUEST_ID_SECRET;
  delete process.env.GUEST_MAX_PER_IP_PER_DAY;
  resetGuestSecretCacheForTests();
}

describe("guest id signing", () => {
  beforeEach(setupSchema);
  after(closeDb);

  it("issues ids that verify and keep the guest_ address shape", () => {
    const id = issueGuestId();
    assert.match(id, /^guest_[0-9a-f]{28}$/);
    assert.equal(isServerIssuedGuestId(id), true);
    assert.equal(isValidGuestId(id), true);
    assert.equal(looksLikeGuestId(id), true);
    // Downstream code (mint-queue guard, manifests) distinguishes guests by the
    // prefix and assumes a lowercase-alnum body — don't break that contract.
    assert.equal(id.startsWith("guest_"), true);
    assert.ok(id.length <= "guest_".length + 32);
  });

  it("issues a different id every time", () => {
    const ids = new Set(Array.from({ length: 50 }, () => issueGuestId()));
    assert.equal(ids.size, 50);
  });

  it("REJECTS a client-minted id — this is the faucet that was open", () => {
    // Exactly what the old getGuestId() produced, and what the old
    // GUEST_ADDRESS_REGEX waved through.
    const selfMinted = "guest_" + Math.random().toString(36).substring(2, 14);
    assert.equal(isServerIssuedGuestId(selfMinted), false);
    assert.equal(isValidGuestId(selfMinted), false);

    // Right shape, wrong signature — guessing the tag must not work either.
    assert.equal(isValidGuestId("guest_" + "0".repeat(28)), false);
    assert.equal(isValidGuestId("guest_deadbeefcafe0123456789abcdef"), false);
  });

  it("rejects a tampered tag and a tampered nonce", () => {
    const id = issueGuestId();
    const flip = (c: string) => (c === "0" ? "1" : "0");

    const badTag = id.slice(0, -1) + flip(id.slice(-1));
    assert.equal(isServerIssuedGuestId(badTag), false);

    // Change the nonce: the tag no longer covers it, so it must fail too.
    const i = "guest_".length;
    const badNonce = id.slice(0, i) + flip(id[i]) + id.slice(i + 1);
    assert.equal(isServerIssuedGuestId(badNonce), false);
  });

  it("rejects malformed and injection-shaped input without throwing", () => {
    for (const bad of [
      "",
      "guest_",
      "guest_ABCDEF0123456789abcdef012345", // uppercase — outside the charset
      "guest_" + "f".repeat(27), // one char short
      "guest_" + "f".repeat(29), // one char long
      'guest_abc") CALL_METHOD Address("x',
      MAINNET_ACCOUNTS[0],
    ]) {
      assert.equal(isServerIssuedGuestId(bad), false, `should reject: ${bad}`);
      assert.equal(isValidGuestId(bad), false, `should reject: ${bad}`);
    }
  });

  it("rejects ids signed under a different key", () => {
    process.env.GUEST_ID_SECRET = "a-secret-long-enough-to-be-accepted";
    resetGuestSecretCacheForTests();
    const underFirstKey = issueGuestId();
    assert.equal(isServerIssuedGuestId(underFirstKey), true);

    process.env.GUEST_ID_SECRET = "a-DIFFERENT-secret-long-enough-here";
    resetGuestSecretCacheForTests();
    assert.equal(isServerIssuedGuestId(underFirstKey), false);
  });

  it("ignores a too-short GUEST_ID_SECRET rather than signing with it", () => {
    process.env.GUEST_ID_SECRET = "short";
    resetGuestSecretCacheForTests();
    const id = issueGuestId();
    // Fell back to the DB-persisted key, which must exist and still verify.
    assert.equal(isServerIssuedGuestId(id), true);
    const row = getDb().prepare("SELECT value FROM server_secrets WHERE name = 'guest_id_hmac'").get();
    assert.ok(row, "expected the persisted key to have been created");
  });

  it("keeps the same persisted key across cache resets, so ids survive a restart", () => {
    const id = issueGuestId();
    resetGuestSecretCacheForTests(); // stands in for a process restart
    assert.equal(isServerIssuedGuestId(id), true);
  });
});

describe("legacy guest ids", () => {
  beforeEach(setupSchema);
  after(closeDb);

  const LEGACY = "guest_kedtjbxl6zb1";

  it("accepts a legacy id only when its player row already exists", () => {
    assert.equal(isKnownLegacyGuestId(LEGACY), false);
    assert.equal(isValidGuestId(LEGACY), false);

    getDb().prepare("INSERT INTO players (radix_address) VALUES (?)").run(LEGACY);
    assert.equal(isKnownLegacyGuestId(LEGACY), true);
    assert.equal(isValidGuestId(LEGACY), true);
  });

  it("does not let grandfathering reopen the faucet for a fresh id", () => {
    // The whole point: an unknown legacy-shaped id is refused, so it never
    // reaches getOrCreatePlayer and can never collect a starting balance.
    getDb().prepare("INSERT INTO players (radix_address) VALUES (?)").run(LEGACY);
    assert.equal(isValidGuestId("guest_" + Math.random().toString(36).substring(2, 14)), false);
  });
});

describe("per-IP guest quota", () => {
  beforeEach(setupSchema);
  after(closeDb);

  const IP = "203.0.113.7";

  it("hashes the IP rather than storing it, stably", () => {
    const h = hashIp(IP);
    assert.equal(h, hashIp(IP));
    assert.notEqual(h, hashIp("203.0.113.8"));
    assert.equal(h.includes(IP), false);
    assert.match(h, /^[0-9a-f]{32}$/);
  });

  it("buckets IPv6 by /64 — one delegated prefix is ONE quota, not 2^64", () => {
    // A subscriber is routinely handed a whole /64. Keying on the full address
    // would make the quota decorative: rotate the low bits, get a fresh 500 MEME
    // every time. That is the exact "bounds throughput but not size" failure the
    // guest faucet had to begin with.
    const a = "2001:db8:abcd:1234::1";
    const b = "2001:db8:abcd:1234:ffff:ffff:ffff:ffff";
    const c = "2001:db8:abcd:1234:0:0:0:beef";
    assert.equal(quotaBucketFor(a), quotaBucketFor(b));
    assert.equal(quotaBucketFor(a), quotaBucketFor(c));
    assert.equal(hashIp(a), hashIp(b));

    // A genuinely different /64 is a different bucket.
    assert.notEqual(quotaBucketFor(a), quotaBucketFor("2001:db8:abcd:1235::1"));

    // And it holds end to end: exhausting the quota from one address in the
    // prefix blocks every other address in that same prefix.
    for (let i = 0; i < guestQuotaPerIp(); i++) {
      assert.equal(issueGuestIdWithinQuota(hashIp(`2001:db8:abcd:1234::${i + 1}`)).ok, true);
    }
    assert.equal(issueGuestIdWithinQuota(hashIp("2001:db8:abcd:1234::dead")).ok, false);
    assert.equal(issueGuestIdWithinQuota(hashIp("2001:db8:abcd:1235::1")).ok, true);
  });

  it("normalises the IPv6 forms Express can hand us", () => {
    // Compressed vs fully expanded must agree, or the same client gets two buckets.
    assert.equal(quotaBucketFor("2001:db8::1"), quotaBucketFor("2001:0db8:0000:0000:0000:0000:0000:0001"));
    // IPv4-mapped ("::ffff:a.b.c.d") is how a dual-stack listener reports IPv4 —
    // it must bucket as the plain IPv4 address, not as an IPv6 prefix.
    assert.equal(quotaBucketFor("::ffff:203.0.113.7"), "203.0.113.7");
    assert.equal(quotaBucketFor("203.0.113.7"), "203.0.113.7");
    // A zone index must not split a bucket.
    assert.equal(quotaBucketFor("fe80::1%eth0"), quotaBucketFor("fe80::1"));
    // Degenerate inputs must be handled, not thrown on.
    for (const odd of ["::1", "unknown", "", "::"]) {
      assert.equal(typeof quotaBucketFor(odd), "string");
      assert.match(hashIp(odd), /^[0-9a-f]{32}$/);
    }
  });

  it("keeps distinct IPv4 addresses in distinct buckets", () => {
    // No /24 sweeping — that would punish unrelated customers of one ISP.
    assert.notEqual(quotaBucketFor("203.0.113.7"), quotaBucketFor("203.0.113.8"));
  });

  it("issues up to the quota, then refuses", () => {
    const ipHash = hashIp(IP);
    const quota = guestQuotaPerIp();

    for (let i = 0; i < quota; i++) {
      const r = issueGuestIdWithinQuota(ipHash);
      assert.equal(r.ok, true, `issue ${i + 1} of ${quota} should succeed`);
      if (r.ok) assert.equal(isServerIssuedGuestId(r.guestId), true);
    }

    const blocked = issueGuestIdWithinQuota(ipHash);
    assert.equal(blocked.ok, false);
    assert.equal(guestQuotaFor(ipHash).remaining, 0);
    assert.equal(guestQuotaFor(ipHash).used, quota);
  });

  it("meters each IP independently", () => {
    const a = hashIp(IP);
    const b = hashIp("198.51.100.4");
    for (let i = 0; i < guestQuotaPerIp(); i++) issueGuestIdWithinQuota(a);

    assert.equal(issueGuestIdWithinQuota(a).ok, false);
    assert.equal(issueGuestIdWithinQuota(b).ok, true);
  });

  it("only counts issues inside the rolling window", () => {
    const ipHash = hashIp(IP);
    const stale = Math.floor(Date.now() / 1000) - GUEST_QUOTA_WINDOW_SEC - 60;

    for (let i = 0; i < guestQuotaPerIp(); i++) {
      getDb()
        .prepare("INSERT INTO guest_ids (guest_address, ip_hash, created_at) VALUES (?, ?, ?)")
        .run(issueGuestId(), ipHash, stale);
    }

    assert.equal(guestQuotaFor(ipHash).used, 0, "yesterday's issues must not block today");
    assert.equal(issueGuestIdWithinQuota(ipHash).ok, true);
  });

  it("honours GUEST_MAX_PER_IP_PER_DAY, and falls back on nonsense", () => {
    process.env.GUEST_MAX_PER_IP_PER_DAY = "2";
    assert.equal(guestQuotaPerIp(), 2);

    const ipHash = hashIp(IP);
    assert.equal(issueGuestIdWithinQuota(ipHash).ok, true);
    assert.equal(issueGuestIdWithinQuota(ipHash).ok, true);
    assert.equal(issueGuestIdWithinQuota(ipHash).ok, false);

    for (const bad of ["0", "-1", "abc", "2.5", "10000"]) {
      process.env.GUEST_MAX_PER_IP_PER_DAY = bad;
      assert.equal(guestQuotaPerIp(), 5, `should fall back on ${bad}`);
    }
  });

  it("records the issuing IP hash and a truncated user agent", () => {
    const ipHash = hashIp(IP);
    const id = issueGuestId();
    recordGuestIssue(id, ipHash, "x".repeat(500));

    const row = getDb()
      .prepare("SELECT ip_hash, user_agent FROM guest_ids WHERE guest_address = ?")
      .get(id) as { ip_hash: string; user_agent: string };
    assert.equal(row.ip_hash, ipHash);
    assert.equal(row.user_agent.length, 200);
  });
});
