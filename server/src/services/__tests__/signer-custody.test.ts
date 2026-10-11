/**
 * Tests for assertSignerCustody() (services/signer.ts) — the boot-time check
 * added after minting silently broke for 8 days: the NFT minter badge moved
 * to a new account on 2026-07-19 but secrets.env still pointed the signer at
 * the old one, and nothing surfaced the mismatch until a transaction failed
 * on-chain. This proves the two things that make the assertion trustworthy:
 *
 *   1. It is not satisfiable by a mocked or absent key. An absent
 *      BOT_PRIVATE_KEY is a deliberate no-op (gameplay-only deployments have
 *      no signer configured at all) — pinned by asserting "custody verified"
 *      never appears on that path, so a no-op can't be read as a pass. A
 *      real key that derives to the WRONG account fails loudly (non-zero
 *      exit, FATAL log naming both addresses) rather than being waved
 *      through.
 *
 *   2. It never touches the network. `virtualAccountAddressFromPublicKey` is
 *      pure local WASM key derivation with no Gateway round trip, which
 *      matters whenever the chain is unreachable: Radix mainnet was halted
 *      2026-08-31 to 2026-09-11, and a boot check that read the chain would
 *      have refused to start every server in this repo until it resumed. Every scenario
 *      below runs with `fetch` stubbed to fail loudly if it is ever called
 *      (see fixtures/run-custody-check.ts) — the offline path is exercised
 *      directly, not assumed from reading the source.
 *
 * assertSignerCustody() and the ACCOUNT/IS_MAINNET/NETWORK constants it
 * closes over are derived from process.env once, at signer.ts's MODULE LOAD
 * time — by design, matching every other constant in that file, since a real
 * server process only ever boots with one env. That makes it untestable via
 * repeated in-process dynamic `import()` with different env per case: tsx's
 * loader caches the module by resolved path (confirmed directly — a second
 * `import()` of the same specifier, even with a `?cachebust=` query, returns
 * the first evaluation's module, not a fresh one). So each scenario here runs
 * `fixtures/run-custody-check.ts` in its own subprocess with its own env,
 * exactly how the real server boots, and asserts on its exit code and
 * stdout/stderr — including the real, unmocked process.exit(1) on mismatch.
 */
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { PrivateKey, RadixEngineToolkit, NetworkId } from "@radixdlt/radix-engine-toolkit";

// ── Real, offline-derived fixtures ──────────────────────────────────────────
//
// Two distinct real ed25519 keys, and the addresses they ACTUALLY derive to —
// computed with the same toolkit primitive signer.ts uses, not hand-typed
// strings. Using a second, unrelated key (not just a flipped character) for
// the "wrong account" cases is what keeps this from being a tautology: KEY_B's
// own real address is what KEY_A is tested against.

const KEY_A_HEX = "aa".repeat(32);
const KEY_B_HEX = "bb".repeat(32);

let keyAStokenet: string;
let keyAMainnet: string;
let keyBStokenet: string;

before(async () => {
  const pkA = new PrivateKey.Ed25519(KEY_A_HEX);
  const pkB = new PrivateKey.Ed25519(KEY_B_HEX);
  keyAStokenet = await RadixEngineToolkit.Derive.virtualAccountAddressFromPublicKey(
    pkA.publicKey(),
    NetworkId.Stokenet
  );
  keyAMainnet = await RadixEngineToolkit.Derive.virtualAccountAddressFromPublicKey(
    pkA.publicKey(),
    NetworkId.Mainnet
  );
  keyBStokenet = await RadixEngineToolkit.Derive.virtualAccountAddressFromPublicKey(
    pkB.publicKey(),
    NetworkId.Stokenet
  );
});

// ── Subprocess runner ────────────────────────────────────────────────────────

const TSX_BIN = path.join(__dirname, "../../../node_modules/.bin/tsx");
const FIXTURE = path.join(__dirname, "fixtures/run-custody-check.ts");

interface CheckResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runCustodyCheck(env: Record<string, string | undefined>): CheckResult {
  const result = spawnSync(TSX_BIN, [FIXTURE], {
    env: { PATH: process.env.PATH, ...env },
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function assertNeverCalledGateway(r: CheckResult) {
  assert.notEqual(r.status, 9, `fixture reported a fetch() call — stderr:\n${r.stderr}`);
  assert.doesNotMatch(r.stdout + r.stderr, /FETCH_CALLED/);
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe("assertSignerCustody (boot check, run as a real subprocess per scenario)", () => {
  it("no-ops when BOT_PRIVATE_KEY is absent — an absent key is not a passing check", () => {
    const r = runCustodyCheck({
      RADIX_NETWORK: "stokenet",
      RADIX_STOKENET_ADDRESS: keyAStokenet,
      // BOT_PRIVATE_KEY deliberately unset.
    });

    assert.equal(r.status, 0);
    assert.match(r.stdout, /CUSTODY_CHECK_OK/);
    assert.doesNotMatch(
      r.stdout,
      /custody verified/,
      "no key configured must not print 'custody verified' — it is a skip, not a pass"
    );
    assertNeverCalledGateway(r);
  });

  it("no-ops when the configured account address is absent", () => {
    const r = runCustodyCheck({
      RADIX_NETWORK: "stokenet",
      BOT_PRIVATE_KEY: KEY_A_HEX,
      BOT_KEY_TYPE: "ed25519",
      // RADIX_STOKENET_ADDRESS deliberately unset.
    });

    assert.equal(r.status, 0);
    assert.match(r.stdout, /CUSTODY_CHECK_OK/);
    assert.doesNotMatch(r.stdout, /custody verified/);
    assertNeverCalledGateway(r);
  });

  it("verifies and logs success when the key derives to the configured account (stokenet)", () => {
    const r = runCustodyCheck({
      RADIX_NETWORK: "stokenet",
      BOT_PRIVATE_KEY: KEY_A_HEX,
      BOT_KEY_TYPE: "ed25519",
      RADIX_STOKENET_ADDRESS: keyAStokenet,
    });

    assert.equal(r.status, 0);
    assert.match(r.stdout, /custody verified/);
    assert.ok(r.stdout.includes(keyAStokenet));
    assertNeverCalledGateway(r);
  });

  it("verifies on mainnet too, against RADIX_MAINNET_ADDRESS", () => {
    const r = runCustodyCheck({
      RADIX_NETWORK: "mainnet",
      BOT_PRIVATE_KEY: KEY_A_HEX,
      BOT_KEY_TYPE: "ed25519",
      RADIX_MAINNET_ADDRESS: keyAMainnet,
    });

    assert.equal(r.status, 0);
    assert.match(r.stdout, /custody verified/);
    assertNeverCalledGateway(r);
  });

  it("exits non-zero when the key does NOT control the configured account — not satisfiable by a wrong key", () => {
    const r = runCustodyCheck({
      RADIX_NETWORK: "stokenet",
      BOT_PRIVATE_KEY: KEY_A_HEX,
      BOT_KEY_TYPE: "ed25519",
      // KEY_B's real (not fabricated) address — a genuine custody mismatch.
      RADIX_STOKENET_ADDRESS: keyBStokenet,
    });

    assert.equal(r.status, 1);
    assert.match(r.stderr, /does not control the configured account/);
    assert.ok(r.stderr.includes(keyBStokenet), "must name the configured (wrong) address");
    assert.doesNotMatch(
      r.stdout,
      /CUSTODY_CHECK_OK|custody verified/,
      "a mismatch must exit before the success line — fail-closed, not fail-open"
    );
    assertNeverCalledGateway(r);
  });

  it("warns but does not exit when NFT_TREASURY_ACCOUNT is a different (real) account", () => {
    const r = runCustodyCheck({
      RADIX_NETWORK: "stokenet",
      BOT_PRIVATE_KEY: KEY_A_HEX,
      BOT_KEY_TYPE: "ed25519",
      RADIX_STOKENET_ADDRESS: keyAStokenet,
      NFT_TREASURY_ACCOUNT: keyBStokenet, // legitimately a gift-only wallet
    });

    assert.equal(r.status, 0);
    assert.match(r.stdout, /custody verified/);
    assert.match(r.stderr, /NFT_TREASURY_ACCOUNT is not the signing account/);
    assertNeverCalledGateway(r);
  });
});
