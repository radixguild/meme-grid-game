/**
 * The gift-rail guard: what it accepts as a destination, and what it refuses.
 *
 * This is the only thing standing between a mistyped env var and every donor's
 * money going somewhere unrecoverable, so it is tested against the official
 * BIP-173 / BIP-350 vectors rather than against a few addresses that happen to
 * look right. The invalid vectors matter more than the valid ones: each is a
 * string a naive "starts with bc1" check would wave through.
 *
 * Kept in step with the Radix Guild app (upstream, radixguild/guild) and the
 * operator's other dapps. A bug fixed in one and not the others means the apps
 * disagree about what a valid address is.
 *
 * Relative imports, not "@/lib/gift": this runs under `tsx --test`, outside
 * Next's bundler, and the gift module is deliberately alias-free so it can.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { verifyBech32, convertBits } from "../bech32";
import { validateBtcMainnetAddress } from "../btc-address";
import { validateGiftDestination, bip21Uri, FORBIDDEN_XRD_DESTINATIONS } from "../index";

// BIP-350 §Test vectors — valid segwit addresses (mainnet subset).
const VALID_SEGWIT = [
  "BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4",
  "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
  "bc1pw508d6qejxtdg4y5r3zarvary0c5xw7kw508d6qejxtdg4y5r3zarvary0c5xw7kt5nd6y",
  "BC1SW50QGDZ25J",
  "bc1zw508d6qejxtdg4y5r3zarvaryvaxxpcs",
];

// BIP-350 §Invalid address — every one of these LOOKS like an address.
const INVALID_SEGWIT: [string, string][] = [
  ["bc1p38j9r5y49hruaue7wxjce0updqjuyyx0kh56v8s25huc6995vvpql3jow4", "bech32 checksum on a v1 address"],
  ["BC130XLXVLHEMJA6C4DQV22UAPCTQUPFHLXM9H8Z3K2E72Q4K9HCZ7VQ7ZWS8R", "invalid character in checksum"],
  ["bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqh2y7hd", "invalid checksum"],
  ["BC1QR508D6QEJXTDG4Y5R3ZARVARYV98GJ9P", "invalid program length for witness v0"],
  ["bc1gmk9yu", "empty data section"],
];

describe("bech32 / bech32m verification", () => {
  test("accepts the official valid vectors", () => {
    for (const addr of VALID_SEGWIT) assert.notEqual(verifyBech32(addr), null, addr);
  });

  test("rejects mixed case rather than normalizing it", () => {
    // BIP-173 treats mixed case as invalid. Normalizing would mean validating
    // a string the operator did not actually supply.
    assert.equal(verifyBech32("bc1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4"), null);
  });

  test("convertBits refuses non-zero padding when unpacking", () => {
    assert.equal(convertBits([31, 31], 5, 8, false), null);
  });
});

describe("validateBtcMainnetAddress", () => {
  test("accepts the official valid segwit vectors", () => {
    for (const addr of VALID_SEGWIT) {
      const r = validateBtcMainnetAddress(addr);
      assert.equal(r.ok, true, `${addr} → ${r.ok ? "" : r.reason}`);
    }
  });

  test("rejects every official invalid vector", () => {
    for (const [addr, why] of INVALID_SEGWIT) {
      assert.equal(validateBtcMainnetAddress(addr).ok, false, `${addr} (${why})`);
    }
  });

  test("a single-character typo in a real address is caught", () => {
    // The whole reason the checksum is verified rather than the shape.
    const real = "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4";
    assert.equal(validateBtcMainnetAddress(real).ok, true);
    assert.equal(validateBtcMainnetAddress(real.replace("qw508", "qw509")).ok, false);
  });

  test("rejects testnet with a reason that says so", () => {
    const r = validateBtcMainnetAddress("tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /testnet/);
  });

  test("legacy addresses pass on shape but are flagged unverified", () => {
    // Documented gap: no base58check here (needs async SHA-256). The flag is
    // the honest signal — a typo in a legacy address CAN pass.
    const r = validateBtcMainnetAddress("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa");
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.kind, "legacy");
      assert.equal(r.checksumVerified, false);
    }
  });
});

describe("validateGiftDestination — the rail guard", () => {
  // A real P2WPKH destination, kept as a vector so the guard is proven against
  // the shape actually used in production, not only against spec examples.
  const REAL_BTC = "bc1qdfwn86z7c4zxy0usq5z7cat8a09aex6pvz8azw";
  // A valid mainnet account address, used here ONLY as a checksum vector. It is
  // NOT a gift destination: do not paste it into the env var.
  const REAL_XRD = "account_rdx12yc8w2pr8dg67kp4rqnayqjx9q8ghdhus07a4l0lfky65yxk9juaze";

  test("accepts a real mainnet P2WPKH gift address", () => {
    const r = validateGiftDestination("btc", REAL_BTC);
    assert.equal(r.ok, true, r.ok ? "" : r.reason);
  });

  test("accepts a real Radix account", () => {
    assert.equal(validateGiftDestination("xrd", REAL_XRD).ok, true);
  });

  test("rejects a Radix address pasted into the BTC rail", () => {
    assert.equal(validateGiftDestination("btc", REAL_XRD).ok, false);
  });

  test("rejects a Radix account with a one-character typo", () => {
    const r = validateGiftDestination("xrd", REAL_XRD.replace("yc8w2", "yc8w3"));
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.reason, /checksum/);
  });

  test("rejects a component_ address pasted into the XRD rail", () => {
    // The length pin exists for exactly this: a component address is still
    // valid bech32m, so only the prefix and length reject it.
    assert.equal(
      validateGiftDestination("xrd", "component_rdx1czexylvvm0q4uhwpjaqmlznj9sd3y2jnmmah6qug9lm9sfm3tyrtva").ok,
      false,
    );
  });

  test("rejects the empty string and whitespace", () => {
    assert.equal(validateGiftDestination("xrd", "").ok, false);
    assert.equal(validateGiftDestination("btc", "   ").ok, false);
  });

  /**
   * A checksum proves "not a typo". It can never prove "the account you
   * meant". Both addresses below are valid, live, 66-character mainnet
   * accounts that can still turn up in the ecosystem's repos and docs — which is
   * precisely what makes them plausible paste errors into the gift env var.
   * They pass every other check in the guard, so they are denied by name.
   */
  describe("forbidden destinations", () => {
    const RETIRED_ACCOUNT = "account_rdx128lggt503h7m2dhzqnrkkqv4zklxcjmdggr8xxtqy8e47p7fkmd8cx";
    const ORPHANED_DAPP_DEF = "account_rdx128y6j78mt0aqv6372evz28hrxp8mn06ccddkr7xppc88hyvynvjdwr";

    test("rejects the retired server account", () => {
      const r = validateGiftDestination("xrd", RETIRED_ACCOUNT);
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.reason, /retired account/);
    });

    test("rejects the orphaned old dApp definition — no key exists for it", () => {
      const r = validateGiftDestination("xrd", ORPHANED_DAPP_DEF);
      assert.equal(r.ok, false);
      if (!r.ok) assert.match(r.reason, /unrecoverable/);
    });

    test("every forbidden address is itself well-formed", () => {
      // If one were malformed the checksum would reject it anyway, and its
      // denylist entry would be dead weight hiding a stale address.
      const addrs = Object.keys(FORBIDDEN_XRD_DESTINATIONS);
      assert.ok(addrs.includes(RETIRED_ACCOUNT), "retired account missing from the map");
      assert.ok(addrs.includes(ORPHANED_DAPP_DEF), "orphaned dApp def missing from the map");
      for (const addr of addrs) {
        assert.equal(addr.length, 66, `${addr} is not 66 chars`);
        assert.equal(verifyBech32(addr)?.encoding, "bech32m", `${addr} fails bech32m`);
      }
    });

    test("denies by exact address, not by prefix — a real account still passes", () => {
      // The guard must not have become "reject anything that looks like ours".
      assert.equal(validateGiftDestination("xrd", REAL_XRD).ok, true);
    });
  });
});

describe("bip21Uri", () => {
  const ADDR = "bc1qdfwn86z7c4zxy0usq5z7cat8a09aex6pvz8azw";

  test("omits the amount entirely when none is given", () => {
    assert.equal(bip21Uri(ADDR), `bitcoin:${ADDR}`);
  });

  test("carries a plain decimal amount and a label", () => {
    assert.equal(bip21Uri(ADDR, "0.001", "Meme Grid"), `bitcoin:${ADDR}?amount=0.001&label=Meme+Grid`);
  });

  test("refuses to build a URI for an invalid address", () => {
    // A scannable URI for a wrong address is the worst possible output here.
    assert.throws(() => bip21Uri("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t5"));
  });

  test("refuses an exponential amount", () => {
    // Some wallets read 1e-4 as an empty amount and send nothing.
    assert.throws(() => bip21Uri(ADDR, "1e-4"));
  });
});
