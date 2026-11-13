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

const STATE_VERSION = 1000;
const DETAILS = "/state/entity/details";
const FUNGIBLES_PAGE = "/state/entity/page/fungibles/";
const NFTS_PAGE = "/state/entity/page/non-fungibles/";

type Reply = { status: number; body: unknown };
type RequestBody = { address?: string; cursor?: string; at_ledger_state?: unknown };
let gatewayCalls: string[] = [];
let gatewayBodies: RequestBody[] = [];
// A fixed reply, or one chosen per request (path and parsed body).
let gatewayReply: Reply | ((url: string, body: RequestBody) => Reply) = { status: 200, body: {} };

const fungibleItems = (resources: string[]) =>
  resources.map((r) => ({ resource_address: r, amount: "1" }));
const nftItems = (nfts: Array<{ resource: string; count: number; name?: string }>) =>
  nfts.map((n) => ({
    resource_address: n.resource,
    amount: n.count,
    explicit_metadata: {
      items: n.name ? [{ key: "name", value: { typed: { type: "String", value: n.name } } }] : [],
    },
  }));

function entityDetails(opts: {
  fungibles?: string[];
  nfts?: Array<{ resource: string; count: number; name?: string }>;
  fungiblesCursor?: string;
  nftsCursor?: string;
}) {
  return {
    ledger_state: { state_version: STATE_VERSION },
    items: [
      {
        address: PRIZE_ACCOUNT,
        fungible_resources: {
          items: fungibleItems(opts.fungibles ?? []),
          ...(opts.fungiblesCursor ? { next_cursor: opts.fungiblesCursor } : {}),
        },
        non_fungible_resources: {
          items: nftItems(opts.nfts ?? []),
          ...(opts.nftsCursor ? { next_cursor: opts.nftsCursor } : {}),
        },
      },
    ],
  };
}

const gateway = http.createServer((req, res) => {
  const url = req.url ?? "";
  gatewayCalls.push(url);
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    gatewayBodies.push(body);
    const reply = typeof gatewayReply === "function" ? gatewayReply(url, body) : gatewayReply;
    res.writeHead(reply.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(reply.body));
  });
});

// ── App under test ──────────────────────────────────────────────────────────

let baseUrl = "";
let signerDerived = "";
let server: http.Server;
let resetCache: () => void;
let ageCache: (ms: number) => void;
let maxPages = 0;
let closeDb: () => void;
let loadDeployState: () => Record<string, any>;

type Pool = { treasury_address: string | null; total_nfts: number };

async function getPool(): Promise<Pool> {
  const res = await fetch(`${baseUrl}/api/vault/nfts`);
  assert.equal(res.status, 200);
  return (await res.json()) as Pool;
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
    const gatewayModule = await import("../../services/gateway");
    closeDb = db.closeDb;
    resetCache = vault.resetNftPoolCacheForTests;
    ageCache = vault.ageNftPoolCacheForTests;
    maxPages = gatewayModule.MAX_HOLDINGS_PAGES;
    loadDeployState = signer.loadDeployState;

    runMigrations(db.getDb());
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    resetCache();
    gatewayCalls = [];
    gatewayBodies = [];
    gatewayReply = { status: 200, body: entityDetails({}) };
    process.env.BOT_PRIVATE_KEY = TEST_KEY_HEX;
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

  it("does not publish anything when the signing key is set but cannot be derived", async () => {
    // A bad key with no configured address passes boot (custody check skipped),
    // so the signer's account is unknown here and must not be guessed.
    process.env.BOT_PRIVATE_KEY = "abcd";
    process.env.NFT_TREASURY_ACCOUNT = PRIZE_ACCOUNT;
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

  it("reads every page of the holdings at one ledger state", async () => {
    process.env.NFT_TREASURY_ACCOUNT = PRIZE_ACCOUNT;
    gatewayReply = (url, body) => {
      if (url === DETAILS) {
        return {
          status: 200,
          body: entityDetails({
            fungibles: ["resource_rdx1test_spam_1"],
            nfts: [{ resource: PRIZE_COLLECTION, count: 1, name: "Prize" }],
            fungiblesCursor: "f2",
            nftsCursor: "n2",
          }),
        };
      }
      if (url === FUNGIBLES_PAGE && body.cursor === "f2") {
        return { status: 200, body: { items: fungibleItems(["resource_rdx1test_spam_2"]), next_cursor: "f3" } };
      }
      if (url === FUNGIBLES_PAGE && body.cursor === "f3") {
        return { status: 200, body: { items: fungibleItems(["resource_rdx1test_spam_3"]) } };
      }
      if (url === NFTS_PAGE && body.cursor === "n2") {
        return { status: 200, body: { items: nftItems([{ resource: PRIZE_COLLECTION, count: 2 }]) } };
      }
      return { status: 404, body: {} };
    };
    const pool = await getPool();
    assert.equal(pool.treasury_address, PRIZE_ACCOUNT);
    assert.equal(pool.total_nfts, 3, "the second page's NFTs are counted");
    assert.deepEqual(gatewayCalls, [DETAILS, FUNGIBLES_PAGE, FUNGIBLES_PAGE, NFTS_PAGE]);
    for (const body of gatewayBodies.slice(1)) {
      assert.equal(body.address, PRIZE_ACCOUNT);
      assert.deepEqual(body.at_ledger_state, { state_version: STATE_VERSION });
    }
  });

  it("does not publish an account holding a custody badge on a later page", async () => {
    process.env.NFT_TREASURY_ACCOUNT = PRIZE_ACCOUNT;
    gatewayReply = (url) =>
      url === DETAILS
        ? { status: 200, body: entityDetails({ nfts: [{ resource: PRIZE_COLLECTION, count: 1 }], fungiblesCursor: "f2" }) }
        : { status: 200, body: { items: fungibleItems([MINTER_BADGE]) } };
    assert.deepEqual(await getPool(), EMPTY);
    assert.deepEqual(gatewayCalls, [DETAILS, FUNGIBLES_PAGE]);
  });

  it("does not publish when the holdings run past the page limit", async () => {
    process.env.NFT_TREASURY_ACCOUNT = PRIZE_ACCOUNT;
    let page = 1;
    gatewayReply = (url) =>
      url === DETAILS
        ? { status: 200, body: entityDetails({ nfts: [{ resource: PRIZE_COLLECTION, count: 1 }], fungiblesCursor: "next" }) }
        : { status: 200, body: { items: fungibleItems([`resource_rdx1test_spam_${++page}`]), next_cursor: "next" } };
    assert.deepEqual(await getPool(), EMPTY);
    assert.equal(gatewayCalls.length, maxPages, "stops at the page limit");
  });

  it("does not publish when more pages exist but the reply has no ledger state to pin them to", async () => {
    process.env.NFT_TREASURY_ACCOUNT = PRIZE_ACCOUNT;
    const { ledger_state, ...body } = entityDetails({
      nfts: [{ resource: PRIZE_COLLECTION, count: 1 }],
      fungiblesCursor: "f2",
    });
    assert.ok(ledger_state, "fixture: the normal reply carries a ledger state");
    gatewayReply = { status: 200, body };
    assert.deepEqual(await getPool(), EMPTY);
    assert.deepEqual(gatewayCalls, [DETAILS]);
  });

  it("does not publish when a Gateway 200 is missing the account or a resource list", async () => {
    process.env.NFT_TREASURY_ACCOUNT = PRIZE_ACCOUNT;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- edits a reply into malformed shapes
    const withEntity = (edit: (entity: any) => void) => {
      const body = entityDetails({ nfts: [{ resource: PRIZE_COLLECTION, count: 1 }] });
      edit(body.items[0]);
      return body;
    };
    const malformed: Array<[string, unknown]> = [
      ["no items", { ledger_state: { state_version: STATE_VERSION } }],
      ["empty items", { ledger_state: { state_version: STATE_VERSION }, items: [] }],
      ["no fungible list", withEntity((e) => delete e.fungible_resources)],
      ["no non-fungible list", withEntity((e) => delete e.non_fungible_resources)],
      ["fungible list without items", withEntity((e) => (e.fungible_resources = {}))],
      ["item without a resource address", withEntity((e) => (e.fungible_resources.items = [{ amount: "1" }]))],
      ["item without an amount", withEntity((e) => delete e.non_fungible_resources.items[0].amount)],
      ["non-string cursor", withEntity((e) => (e.fungible_resources.next_cursor = 2))],
    ];
    for (const [label, body] of malformed) {
      resetCache();
      gatewayReply = { status: 200, body };
      assert.deepEqual(await getPool(), EMPTY, label);
    }
  });

  it("serves the last checked answer through a short Gateway outage, then stops", async () => {
    process.env.NFT_TREASURY_ACCOUNT = PRIZE_ACCOUNT;
    gatewayReply = { status: 200, body: entityDetails({ nfts: [{ resource: PRIZE_COLLECTION, count: 1 }] }) };
    assert.equal((await getPool()).treasury_address, PRIZE_ACCOUNT);

    gatewayReply = { status: 503, body: { error: "down" } };
    ageCache(5 * 60 * 1000 + 1000); // past the 5-min TTL: re-checks, the Gateway fails
    assert.equal((await getPool()).treasury_address, PRIZE_ACCOUNT, "a recent answer is still served");
    assert.equal(gatewayCalls.length, 2, "it did re-check");

    ageCache(5 * 60 * 1000); // now past twice the TTL since the last good check
    assert.deepEqual(await getPool(), EMPTY);
  });

  it("does not publish an unchecked address when the Gateway is down", async () => {
    process.env.NFT_TREASURY_ACCOUNT = PRIZE_ACCOUNT;
    gatewayReply = { status: 503, body: { error: "down" } };
    assert.deepEqual(await getPool(), EMPTY);
  });
});
