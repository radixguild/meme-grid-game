/**
 * The treasury guard's own fail-closed edges, without the HTTP route:
 * an unreadable deploy-state.json and an underivable signing key both refuse.
 * routes/__tests__/vault-nft-treasury-guard.test.ts covers the route.
 */
process.env.DB_PATH = ":memory:";
process.env.RADIX_NETWORK = "mainnet";

import { describe, it, before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PrivateKey, RadixEngineToolkit, NetworkId } from "@radixdlt/radix-engine-toolkit";
import { MAINNET_ACCOUNTS } from "../../__tests__/fixtures/addresses";
import type { AccountHoldings } from "../gateway";

const PRIZE_ACCOUNT = MAINNET_ACCOUNTS[1];
const MINTER_BADGE = "resource_rdx1test_minter_badge_for_guard_unit";
const RECORDED_BADGE = "resource_rdx1test_recorded_owner_badge";
const CLEAN: AccountHoldings = { nftCollections: [], resourceAddresses: [], incomplete: false };

let guard: typeof import("../treasury-guard");
let signer: typeof import("../signer");
let dir = "";
const saved = { key: process.env.BOT_PRIVATE_KEY, type: process.env.BOT_KEY_TYPE, minter: process.env.NFT_MINTER_BADGE };

describe("treasury guard", () => {
  before(async () => {
    guard = await import("../treasury-guard");
    signer = await import("../signer");
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "treasury-guard-test-"));
  });

  afterEach(() => {
    for (const [name, value] of [
      ["BOT_PRIVATE_KEY", saved.key],
      ["BOT_KEY_TYPE", saved.type],
      ["NFT_MINTER_BADGE", saved.minter],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("readDeployStateStrict", () => {
    const write = (name: string, text: string) => {
      const file = path.join(dir, name);
      fs.writeFileSync(file, text);
      return file;
    };

    it("returns the recorded object", () => {
      const file = write("ok.json", JSON.stringify({ v1: { ownerBadge: RECORDED_BADGE } }));
      assert.deepEqual(signer.readDeployStateStrict(file), { v1: { ownerBadge: RECORDED_BADGE } });
    });

    it("throws when the file is missing, corrupt or not an object", () => {
      assert.throws(() => signer.readDeployStateStrict(path.join(dir, "missing.json")), "missing");
      assert.throws(() => signer.readDeployStateStrict(write("corrupt.json", '{"v1": {')), "corrupt");
      assert.throws(() => signer.readDeployStateStrict(write("null.json", "null")), "null");
      assert.throws(() => signer.readDeployStateStrict(write("array.json", "[]")), "array");
      assert.throws(() => signer.readDeployStateStrict(write("string.json", '"x"')), "string");
    });

    it("reads the committed deploy-state.json", () => {
      assert.ok(guard.knownCustodyBadges().size > 0, "the committed file records badges");
    });
  });

  describe("refuseIfHoldsCustodyBadge", () => {
    it("refuses when deploy-state.json cannot be read, even for clean holdings", () => {
      process.env.NFT_MINTER_BADGE = MINTER_BADGE;
      const unreadable = () => {
        throw new Error("ENOENT");
      };
      assert.throws(() => guard.knownCustodyBadges(unreadable));
      assert.equal(guard.refuseIfHoldsCustodyBadge(CLEAN, unreadable), "custody_badges_unknown");
    });

    it("refuses a badge recorded in deploy-state.json and passes clean holdings", () => {
      delete process.env.NFT_MINTER_BADGE;
      const state = () => ({ v1: { ownerBadge: RECORDED_BADGE } });
      assert.equal(
        guard.refuseIfHoldsCustodyBadge({ ...CLEAN, resourceAddresses: [RECORDED_BADGE] }, state),
        "holds_custody_badge",
      );
      assert.equal(guard.refuseIfHoldsCustodyBadge(CLEAN, state), null);
    });

    it("refuses incomplete holdings", () => {
      assert.equal(guard.refuseIfHoldsCustodyBadge({ ...CLEAN, incomplete: true }, () => ({})), "holdings_incomplete");
    });
  });

  describe("refuseIfSigner", () => {
    it("refuses as signer_unknown when the key is set but cannot be derived", async () => {
      process.env.BOT_KEY_TYPE = "ed25519";
      process.env.BOT_PRIVATE_KEY = "abcd";
      assert.equal(await guard.refuseIfSigner(PRIZE_ACCOUNT), "signer_unknown");
    });

    it("refuses the account the key derives to", async () => {
      process.env.BOT_KEY_TYPE = "ed25519";
      process.env.BOT_PRIVATE_KEY = "aa".repeat(32);
      const derived = await RadixEngineToolkit.Derive.virtualAccountAddressFromPublicKey(
        new PrivateKey.Ed25519("aa".repeat(32)).publicKey(),
        NetworkId.Mainnet,
      );
      assert.equal(await guard.refuseIfSigner(derived), "is_signer");
      assert.equal(await guard.refuseIfSigner(PRIZE_ACCOUNT), null);
    });
  });
});
