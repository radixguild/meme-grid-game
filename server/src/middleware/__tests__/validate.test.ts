process.env.DB_PATH = ":memory:";
// validateAddress checks the network too, so tests must say which one they mean.
process.env.RADIX_NETWORK = "mainnet";

/**
 * Tests for isOnChainAddress — the predicate gating which addresses may be
 * put into a transaction manifest. A guest address reaching a manifest means
 * a tx that can never build, so the guest/real distinction must be exact.
 */
import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { isOnChainAddress, validateAddress } from "../validate";
import { getDb, closeDb } from "../../db/connection";
import { issueGuestId, resetGuestSecretCacheForTests } from "../../auth/guest-id";
import { resetAddressCacheForTests } from "../../auth/address-validation";
import {
  MAINNET_ACCOUNTS,
  STOKENET_ACCOUNTS,
  FABRICATED_ACCOUNTS,
  MAINNET_RESOURCE,
} from "../../__tests__/fixtures/addresses";

describe("isOnChainAddress", () => {
  it("accepts real mainnet and stokenet accounts", () => {
    assert.equal(
      isOnChainAddress(MAINNET_ACCOUNTS[0]),
      true
    );
    assert.equal(
      isOnChainAddress("account_tdx_2_12yfwevmvnqgd3ppzau66cm9xu874srmrt9g2cye3fa8j8y78z9sq"),
      true
    );
  });

  it("rejects guest pseudo-addresses (the mint-queue bug)", () => {
    assert.equal(isOnChainAddress("guest_kedtjbxl6zb1"), false);
    assert.equal(isOnChainAddress("guest_k2rnznh3cca"), false);
  });

  it("rejects resource/component addresses and malformed input", () => {
    // Wrong entity type — must not be depositable targets
    assert.equal(
      isOnChainAddress("resource_rdx1t5ykfc49ap6x8gsf6hjjutv4d9hwn70ha2kwc6wm2m472f88a48r8s"),
      false
    );
    assert.equal(
      isOnChainAddress("component_rdx1cq9z0p42ndk4ckvpha3tu3g7h2fr4k373htcmfl4d6zvgjl8s028wv"),
      false
    );
    assert.equal(isOnChainAddress(""), false);
    assert.equal(isOnChainAddress("account_rdx1"), false);
    // Manifest-injection shapes must never pass
    assert.equal(isOnChainAddress('account_rdx1abc") CALL_METHOD Address("x'), false);
  });
});

// ── validateAddress ─────────────────────────────────────────────────────────
//
// The middleware every `/:address` route sits behind. It used to accept any
// string shaped like `guest_[a-z0-9]{8,32}`, which — because the free 500-MEME
// starting balance is granted once per unseen address — made "invent an
// address" and "mint 500 MEME" the same operation
// (docs/GAME-DESIGN-REVIEW.md §5). These tests pin it shut.

async function run(address: unknown) {
  const req = { params: { address } } as unknown as Request;
  const res: any = { _status: 200, _json: null };
  res.status = (code: number) => { res._status = code; return res; };
  res.json = (body: any) => { res._json = body; return res; };
  let passed = false;
  const next: NextFunction = () => { passed = true; };
  // Async since the bech32m checksum comes from the WASM-backed toolkit.
  await validateAddress(req, res as Response, next);
  return { passed, status: res._status as number, body: res._json };
}

function setupGuestSchema() {
  const db = getDb();
  db.exec("DROP TABLE IF EXISTS server_secrets");
  db.exec("DROP TABLE IF EXISTS players");
  db.exec(`
    CREATE TABLE server_secrets (name TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE players (radix_address TEXT PRIMARY KEY);
  `);
  delete process.env.GUEST_ID_SECRET;
  resetGuestSecretCacheForTests();
  resetAddressCacheForTests();
}

describe("validateAddress", () => {
  beforeEach(setupGuestSchema);
  after(closeDb);

  it("passes real, checksum-valid Radix accounts through", async () => {
    for (const a of MAINNET_ACCOUNTS) {
      assert.equal((await run(a)).passed, true, `should accept ${a.slice(0, 24)}…`);
    }
  });

  it("REJECTS a fabricated account address — shape-valid, checksum-invalid", async () => {
    // This is item 14: `account_rdx1` + arbitrary characters used to pass and be
    // funded with 500 MEME, and to enter the NFT mint queue where it can only
    // burn server-funded tx fees.
    for (const fake of FABRICATED_ACCOUNTS) {
      const r = await run(fake);
      assert.equal(r.passed, false, `must reject ${fake.slice(0, 24)}…`);
      assert.equal(r.status, 400);
      assert.equal(r.body.code, "address_invalid");
    }
  });

  it("REJECTS a valid address from the wrong network", async () => {
    // Server is mainnet here. A real stokenet account is a config accident, not
    // a player — and funding it would be funding a different ledger's identity.
    for (const a of STOKENET_ACCOUNTS) {
      assert.equal((await run(a)).passed, false, `must reject stokenet ${a.slice(0, 24)}…`);
    }
  });

  it("REJECTS a valid address that is not an account", async () => {
    // Right shape family, real checksum, wrong entity — a resource address is
    // not somewhere a player can be paid.
    assert.equal((await run(MAINNET_RESOURCE)).passed, false);
  });

  it("passes a server-issued guest id", async () => {
    const r = await run(issueGuestId());
    assert.equal(r.passed, true);
  });

  it("REJECTS a client-minted guest id — the guest faucet", async () => {
    const r = await run("guest_" + Math.random().toString(36).substring(2, 14));
    assert.equal(r.passed, false, "a self-minted guest id must never reach a route");
    assert.equal(r.status, 401);
    assert.equal(r.body.code, "guest_id_invalid");
  });

  it("tells a stale guest to start a new session, rather than a bare format error", async () => {
    // Distinguishable codes matter: the client clears its stored id on
    // `guest_id_invalid` (useGame.tsx), which is the only way out of the loop.
    const r = await run("guest_" + "a".repeat(28));
    assert.equal(r.status, 401);
    assert.equal(r.body.code, "guest_id_invalid");
  });

  it("still accepts a pre-existing legacy guest id that has a player row", async () => {
    const legacy = "guest_kedtjbxl6zb1";
    assert.equal((await run(legacy)).passed, false, "unknown legacy id must be refused");

    getDb().prepare("INSERT INTO players (radix_address) VALUES (?)").run(legacy);
    assert.equal((await run(legacy)).passed, true, "an existing guest must not lose their account");
  });

  it("rejects missing and malformed addresses with a 400", async () => {
    assert.equal((await run(undefined)).status, 400);
    assert.equal((await run("")).status, 400);
    assert.equal((await run("not-an-address")).status, 400);
    assert.equal((await run('account_rdx1abc") CALL_METHOD Address("x')).status, 400);
  });

  it("honours the ADDRESS_CHECKSUM_ENFORCE kill switch", async () => {
    // The escape hatch exists because getting this wrong 400s every real player.
    // Off, it degrades to the old shape-only behaviour — the per-IP quota still
    // bounds the faucet, so this is a fallback, not an open door.
    assert.equal((await run(FABRICATED_ACCOUNTS[0])).passed, false);
    process.env.ADDRESS_CHECKSUM_ENFORCE = "false";
    resetAddressCacheForTests();
    assert.equal((await run(FABRICATED_ACCOUNTS[0])).passed, true);
    delete process.env.ADDRESS_CHECKSUM_ENFORCE;
  });
});
