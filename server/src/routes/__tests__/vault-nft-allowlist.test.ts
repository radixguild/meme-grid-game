// Env must be set before any import: the DB singleton opens on first getDb().
process.env.DB_PATH = ":memory:";
process.env.RADIX_NETWORK = "mainnet";
// The safe default under test: no treasury declared.
delete process.env.NFT_TREASURY_ACCOUNT;

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { getDb, closeDb } from "../../db/connection";
import { runMigrations } from "../../db/migrations/runner";
import { createApp } from "../../app";

let baseUrl = "";
let server: ReturnType<ReturnType<typeof createApp>["listen"]>;

// docs/PROJECT-STATE.md item 16: the prize-resource allowlist must not change
// the treasury-unset early return — no address published, nothing counted.
describe("GET /api/vault/nfts — treasury unset", () => {
  before(async () => {
    delete process.env.NFT_TREASURY_ACCOUNT;
    runMigrations(getDb());
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDb();
  });

  it("returns the empty pool exactly as before", async () => {
    const res = await fetch(`${baseUrl}/api/vault/nfts`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      ok: true,
      treasury_address: null,
      collections: [],
      total_nfts: 0,
    });
  });
});
