/**
 * GET /api/vault/nfts must never publish the server's signing account, or an
 * account holding a known custody badge, as the prize account. Everything
 * unproven publishes nothing.
 *
 * The Gateway is a local stub (GATEWAY_URL is read at module load, so it is set
 * before the app is imported) that records every call, so "refused before any
 * Gateway read" is asserted, not assumed. The signer key is a fixed test key;
 * no real funds or network are involved.
 */
import { describe, it, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { PrivateKey, RadixEngineToolkit, NetworkId } from "@radixdlt/radix-engine-toolkit";
import { MAINNET_ACCOUNTS } from "../../__tests__/fixtures/addresses";

const TEST_KEY_HEX = "aa".repeat(32);
// Configured signer address deliberately differs from the key's own address,
// so both halves of "the signer's account" are exercised in one process.
const CONFIGURED_SIGNER = MAINNET_ACCOUNTS[3];
const PRIZE_ACCOUNT = MAINNET_ACCOUNTS[1];
const MINTER_BADGE = "resource_rdx1test_minter_badge_for_vault_guard";
const PRIZE_COLLECTION = "resource_rdx1test_prize_collection_for_vault_guard";

const EMPTY = { ok: true, treasury_address: null, collections: [], total_nfts: 0 };

// ── Gateway stub ────────────────────────────────────────────────────────────

let gatewayCalls: string[] = [];
let gatewayReply: { status: number; body: unknown } = { status: 200, body: {} };

function entityDetails(opts: {
  fungibles?: string[];
  nfts?: Array<{ resource: string; count: number; name?: string }>;
  truncated?: boolean;
}) {
  return {
    items: [
      {
        address: PRIZE_ACCOUNT,
        fungible_resources: {
          items: (opts.fungibles ?? []).map((r) => ({ resource_address: r, amount: "1" })),
          ...(opts.truncated ? { next_cursor: "page-2" } : {}),
        },
        non_fungible_resources: {
          items: (opts.nfts ?? []).map((n) => ({
            resource_address: n.resource,
            amount: n.count,
            explicit_metadata: {
              items: n.name ? [{ key: "name", value: { typed: { type: "String", value: n.name } } }] : [],
            },
          })),
        },
      },
    ],
  };
}

const gateway = http.createServer((req, res) => {
  gatewayCalls.push(req.url ?? "");
  req.resume();
  req.on("end", () => {
    res.writeHead(gatewayReply.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(gatewayReply.body));
  });
});

// ── App under test ──────────────────────────────────────────────────────────

let baseUrl = "";
let signerDerived = "";
let server: http.Server;
let resetCache: () => void;
let closeDb: () => void;
let loadDeployState: () => Record<string, any>;

async function getPool() {
  const res = await fetch(`${baseUrl}/api/vault/nfts`);
  assert.equal(res.status, 200);
  return res.json();
}

describe("GET /api/vault/nfts — treasury guard", () => {
  before(async () => {
    gateway.listen(0);
    await new Promise<void>((resolve) => gateway.once("listening", resolve));
    const gw = gateway.address() as AddressInfo;

    signerDerived = await RadixEngineToolkit.Derive.virtualAccountAddressFromPublicKey(
      new PrivateKey.Ed25519(TEST_KEY_HEX).publicKey(),
      NetworkId.Mainnet,
    );

    process.env.DB_PATH = ":memory:";
    process.env.RADIX_NETWORK = "mainnet";
    process.env.GATEWAY_URL = `http://127.0.0.1:${gw.port}`;
    process.env.BOT_PRIVATE_KEY = TEST_KEY_HEX;
    process.env.BOT_KEY_TYPE = "ed25519";
    process.env.RADIX_MAINNET_ADDRESS = CONFIGURED_SIGNER;
    process.env.NFT_PRIZE_RESOURCE_ALLOWLIST = PRIZE_COLLECTION;

    const db = await import("../../db/connection");
    const { runMigrations } = await import("../../db/migrations/runner");
    const { createApp } = await import("../../app");
    const vault = await import("../vault");
    const signer = await import("../../services/signer");
    closeDb = db.closeDb;
    resetCache = vault.resetNftPoolCacheForTests;
    loadDeployState = signer.loadDeployState;

    runMigrations(db.getDb());
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    resetCache();
    gatewayCalls = [];
    gatewayReply = { status: 200, body: entityDetails({}) };
    process.env.NFT_MINTER_BADGE = MINTER_BADGE;
    delete process.env.NFT_TREASURY_ACCOUNT;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await new Promise<void>((resolve) => gateway.close(() => resolve()));
    closeDb();
  });

  it("does not publish the account the signing key derives to", async () => {
    process.env.NFT_TREASURY_ACCOUNT = signerDerived;
    assert.deepEqual(await getPool(), EMPTY);
    assert.deepEqual(gatewayCalls, [], "refused before any Gateway read");
  });

  it("does not publish the configured signer account", async () => {
    process.env.NFT_TREASURY_ACCOUNT = CONFIGURED_SIGNER;
    assert.deepEqual(await getPool(), EMPTY);
    assert.deepEqual(gatewayCalls, [], "refused before any Gateway read");
  });

  it("publishes a separate prize account with only its allowlisted collections", async () => {
    process.env.NFT_TREASURY_ACCOUNT = PRIZE_ACCOUNT;
    gatewayReply = {
      status: 200,
      body: entityDetails({
        nfts: [
          { resource: PRIZE_COLLECTION, count: 3, name: "Prize" },
          { resource: "resource_rdx1test_not_allowlisted", count: 9 },
        ],
      }),
    };
    assert.deepEqual(await getPool(), {
      ok: true,
      treasury_address: PRIZE_ACCOUNT,
      collections: [{ resource_address: PRIZE_COLLECTION, name: "Prize", icon_url: null, count: 3 }],
      total_nfts: 3,
    });
  });

  it("does not publish an account holding the minter badge", async () => {
    process.env.NFT_TREASURY_ACCOUNT = PRIZE_ACCOUNT;
    gatewayReply = {
      status: 200,
      body: entityDetails({
        fungibles: [MINTER_BADGE],
        nfts: [{ resource: PRIZE_COLLECTION, count: 1 }],
      }),
    };
    assert.deepEqual(await getPool(), EMPTY);
  });

  it("does not publish an account holding a badge recorded in deploy-state.json", async () => {
    const recorded = loadDeployState().memeTokenV1Dead?.ownerBadge;
    assert.match(String(recorded), /^resource_/, "fixture: deploy-state.json records a badge");
    process.env.NFT_TREASURY_ACCOUNT = PRIZE_ACCOUNT;
    gatewayReply = {
      status: 200,
      body: entityDetails({ fungibles: [recorded], nfts: [{ resource: PRIZE_COLLECTION, count: 1 }] }),
    };
    assert.deepEqual(await getPool(), EMPTY);
  });

  it("does not publish when the Gateway returned only part of the holdings", async () => {
    process.env.NFT_TREASURY_ACCOUNT = PRIZE_ACCOUNT;
    gatewayReply = {
      status: 200,
      body: entityDetails({ truncated: true, nfts: [{ resource: PRIZE_COLLECTION, count: 1 }] }),
    };
    assert.deepEqual(await getPool(), EMPTY);
  });

  it("does not publish an unchecked address when the Gateway is down", async () => {
    process.env.NFT_TREASURY_ACCOUNT = PRIZE_ACCOUNT;
    gatewayReply = { status: 503, body: { error: "down" } };
    assert.deepEqual(await getPool(), EMPTY);
  });
});
