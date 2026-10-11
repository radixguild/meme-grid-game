process.env.DB_PATH = ":memory:";
process.env.RADIX_NETWORK = "stokenet";

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../../app";
import { getDb, closeDb } from "../../db/connection";
import { runMigrations } from "../../db/migrations/runner";
import { FREE_STARTING_BALANCE } from "../../game/economy";
import { resetGuestSecretCacheForTests } from "../../auth/guest-id";
import { issueSession } from "../../auth/session";
import { STOKENET_ACCOUNTS, MAINNET_ACCOUNTS, FABRICATED_ACCOUNTS } from "../../__tests__/fixtures/addresses";

/**
 * End-to-end proof that the free-ROLLS faucet is shut
 * (docs/GAME-DESIGN-REVIEW.md §5).
 *
 * Unit tests pin the pieces; this one drives the real Express stack, because
 * the bug was never in one function — it was that no layer between "a browser
 * makes up a string" and "the server credits 500 MEME" ever asked where the
 * string came from.
 *
 * Every request sets X-Forwarded-For so `req.ip` is the address under test —
 * app.ts sets `trust proxy = 1`, which is what makes that header authoritative
 * here (see __tests__/trust-proxy.test.ts).
 */

let server: Server;
let base: string;

async function req(
  path: string,
  opts: { method?: string; ip?: string; token?: string } = {}
): Promise<{ status: number; body: any }> {
  const headers: Record<string, string> = { "X-Forwarded-For": opts.ip ?? "203.0.113.10" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? "GET",
    headers,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** A live ROLA session token for `address` — GET /api/game/:address now
 * requires one for real `account_…` addresses (required-for-wallets,
 * PROJECT-STATE.md item 3). Guests never need this. */
const sessionFor = (address: string): string => issueSession({ radix_address: address }).token;

const newGuest = async (ip?: string) => req("/api/guest/new", { method: "POST", ip });

// Derive a valid stokenet account on demand — needed to test the per-IP cap,
// which requires more distinct real addresses than the fixture list holds.
// Address derivation only; no private key exists for any of these.
async function freshStokenetAccount(seed: number): Promise<string> {
  const { RadixEngineToolkit, PublicKey, NetworkId } = await import("@radixdlt/radix-engine-toolkit");
  const bytes = new Uint8Array(32).fill(100 + seed);
  return RadixEngineToolkit.Derive.virtualAccountAddressFromPublicKey(
    new PublicKey.Ed25519(bytes),
    NetworkId.Stokenet
  );
}
const balanceOf = (address: string): number | null => {
  const row = getDb()
    .prepare("SELECT meme_balance AS b FROM players WHERE radix_address = ?")
    .get(address) as { b: number } | undefined;
  return row?.b ?? null;
};

describe("guest identity faucet", () => {
  before(async () => {
    runMigrations(getDb());
    resetGuestSecretCacheForTests();
    server = createApp().listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    closeDb();
  });

  it("credits the starting balance to a server-issued guest, exactly once", async () => {
    const issued = await newGuest("203.0.113.11");
    assert.equal(issued.status, 200);
    const id: string = issued.body.guest_id;
    assert.match(id, /^guest_[0-9a-f]{28}$/);

    // Guest play must work end to end with no wallet and no XRD.
    const first = await req(`/api/game/${id}`, { ip: "203.0.113.11" });
    assert.equal(first.status, 200);
    assert.equal(first.body.ok, true);
    assert.equal(first.body.player.meme_balance, FREE_STARTING_BALANCE);

    // …and only once, no matter how often the client refreshes.
    await req(`/api/game/${id}`, { ip: "203.0.113.11" });
    await req(`/api/game/${id}`, { ip: "203.0.113.11" });
    assert.equal(balanceOf(id), FREE_STARTING_BALANCE);
  });

  it("refuses a self-minted guest id, so no player row and no balance appear", async () => {
    // Verbatim the old client's `getGuestId()`.
    const selfMinted = "guest_" + Math.random().toString(36).substring(2, 14);

    const res = await req(`/api/game/${selfMinted}`, { ip: "203.0.113.12" });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, "guest_id_invalid");
    assert.equal(balanceOf(selfMinted), null, "no player row may be created for an unissued id");
  });

  it("refuses a forged id of the right shape", async () => {
    const forged = "guest_" + "ab".repeat(14);
    const res = await req(`/api/game/${forged}`, { ip: "203.0.113.12" });
    assert.equal(res.status, 401);
    assert.equal(balanceOf(forged), null);
  });

  it("caps how much an IP can mint in a day, and says so", async () => {
    const ip = "203.0.113.13";
    const quota = (await req("/api/guest/quota", { ip })).body.quota as number;

    const ids: string[] = [];
    for (let i = 0; i < quota; i++) {
      const r = await newGuest(ip);
      assert.equal(r.status, 200, `issue ${i + 1}/${quota}`);
      ids.push(r.body.guest_id);
    }

    const blocked = await newGuest(ip);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.ok, false);
    // The wall must point somewhere: a real player behind a shared NAT needs to
    // learn that connecting a wallet is the way through.
    assert.match(blocked.body.error, /wallet/i);

    // The total giveaway to this IP is bounded by quota × the starting balance.
    for (const id of ids) await req(`/api/game/${id}`, { ip });
    const total = ids.reduce((sum, id) => sum + (balanceOf(id) ?? 0), 0);
    assert.equal(total, quota * FREE_STARTING_BALANCE);

    assert.equal((await req("/api/guest/quota", { ip })).body.remaining, 0);
  });

  it("meters per IP — one exhausted network doesn't lock out everyone else", async () => {
    const exhausted = "203.0.113.14";
    const quota = (await req("/api/guest/quota", { ip: exhausted })).body.quota as number;
    for (let i = 0; i < quota; i++) await newGuest(exhausted);

    assert.equal((await newGuest(exhausted)).status, 429);
    assert.equal((await newGuest("198.51.100.9")).status, 200);
  });

  it("refuses to fund a real account with no ROLA session — item 3 closing item 14", async () => {
    // Before item 3 shipped, a checksum-valid `account_…` address alone was
    // enough to collect the starting balance — the exact hole item 14
    // documented (anyone can derive a valid address offline). Now the
    // route requires a proven session for on-chain addresses.
    const addr = STOKENET_ACCOUNTS[1];
    const res = await req(`/api/game/${addr}`, { ip: "203.0.113.15" });
    assert.equal(res.status, 401);
    assert.equal(balanceOf(addr), null, "no funding without a proven session");
  });

  it("still funds a real, checksum-valid Radix account — once it holds a session", async () => {
    // The old fixture here was a fabricated string that only LOOKED like a
    // stokenet address — it could never exist on-ledger, so this test was not
    // exercising the wallet path at all. Now it uses a derived, valid one,
    // with the ROLA session that proves ownership (item 3). Deliberately
    // STOKENET_ACCOUNTS[0], not [1] above: the "caps how many NEW accounts"
    // test later in this file relies on this address already being an
    // established player.
    const addr = STOKENET_ACCOUNTS[0];
    const token = sessionFor(addr);
    const res = await req(`/api/game/${addr}`, { ip: "203.0.113.15", token });
    assert.equal(res.status, 200);
    assert.equal(res.body.player.meme_balance, FREE_STARTING_BALANCE);
  });

  it("REFUSES a fabricated account address — the item-14 faucet", async () => {
    // Shape-valid, checksum-invalid. This used to return 200 and mint 500 MEME,
    // and every such address that later unlocked an NFT also entered the mint
    // queue, where it burns server-funded tx fees on a tx that can never build.
    for (const fake of FABRICATED_ACCOUNTS) {
      const res = await req(`/api/game/${fake}`, { ip: "203.0.113.16" });
      assert.equal(res.status, 400, `should reject ${fake.slice(0, 24)}…`);
      assert.equal(res.body.code, "address_invalid");
      assert.equal(balanceOf(fake), null, "no player row may be created");
    }
  });

  it("REFUSES a valid address from the wrong network", async () => {
    // Server is stokenet here; a real mainnet address is a config accident.
    const res = await req(`/api/game/${MAINNET_ACCOUNTS[0]}`, { ip: "203.0.113.17" });
    assert.equal(res.status, 400);
    assert.equal(balanceOf(MAINNET_ACCOUNTS[0]), null);
  });

  it("caps how many NEW accounts one IP can have funded per day", async () => {
    // The checksum stops fabricated addresses, and a ROLA session (item 3)
    // now proves ownership — but anyone can generate real keypairs offline,
    // derive a valid address AND sign a genuine challenge for it (holding
    // the key is exactly what "generate offline" gives them), so a session
    // alone does not bound the giveaway either. Only this per-IP quota does.
    const ip = "203.0.113.18";
    const quota = 10; // ACCOUNT_MAX_NEW_PER_IP_PER_DAY default
    for (let i = 0; i < quota; i++) {
      const a = await freshStokenetAccount(i);
      const r = await req(`/api/game/${a}`, { ip, token: sessionFor(a) });
      assert.equal(r.status, 200, `account ${i + 1}/${quota} should be funded`);
    }
    const overQuotaAddr = await freshStokenetAccount(99);
    const blocked = await req(`/api/game/${overQuotaAddr}`, { ip, token: sessionFor(overQuotaAddr) });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.code, "starting_balance_quota");

    // An account that has ALREADY played must not be locked out by its network
    // hitting the cap — the quota gates new funding, not existing players.
    // (Established by the earlier "still funds…" test in this file.)
    const established = STOKENET_ACCOUNTS[0];
    const r = await req(`/api/game/${established}`, { ip, token: sessionFor(established) });
    assert.equal(r.status, 200);
  });
});
