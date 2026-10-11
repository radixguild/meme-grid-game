/**
 * Tests for the live ROLLS price read (services/vault-price.ts).
 *
 * Two things are worth pinning here and they are different in kind:
 *
 *   - `parseXrdPerRoll` is the part that can silently be WRONG. The Gateway response
 *     shape below is not invented: it was read from the live v1 component on mainnet
 *     (component_rdx1czh262wv…tj6lgxy) while writing this, which is why the v1
 *     fixture has `meme_resource_manager` and no `xrd_per_roll` — that is genuinely
 *     what v1 returns, and pointing the parser at a v1 component must yield null
 *     rather than a confident wrong answer.
 *
 *   - `getXrdPerRoll` must never REJECT. `GET /token/info` is an express handler and
 *     the endpoint the client bootstraps from; under express 4 an async rejection
 *     there hangs the request instead of failing it. The fetcher is injectable
 *     precisely so that promise can be tested without a network.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  parseXrdPerRoll,
  getXrdPerRoll,
  __resetVaultPriceCacheForTests,
  MIN_XRD_PER_ROLL,
  MAX_XRD_PER_ROLL,
} from "../vault-price";
import { XRD_PER_ROLL } from "../../game/economy";

const COMPONENT = "component_rdx1cptest";

/** A v2 component's state as the Gateway renders it. */
function v2Response(xrdPerRoll: string, kind = "Decimal") {
  return {
    items: [
      {
        details: {
          type: "Component",
          state: {
            kind: "Tuple",
            fields: [
              { field_name: "xrd_vault", kind: "Own", value: "internal_vault_rdx1tr" },
              { field_name: "rolls_resource_manager", kind: "Reference", value: "resource_rdx1t4" },
              { field_name: "total_minted", kind: "Decimal", value: "0" },
              { field_name: "total_burned", kind: "Decimal", value: "0" },
              { field_name: "paused", kind: "Bool", value: false },
              { field_name: "xrd_per_roll", kind, value: xrdPerRoll },
            ],
          },
        },
      },
    ],
  };
}

/** The v1 component's real state — no price field at all. */
const V1_RESPONSE = {
  items: [
    {
      details: {
        type: "Component",
        state: {
          kind: "Tuple",
          fields: [
            { field_name: "xrd_vault", kind: "Own", value: "internal_vault_rdx1tr" },
            { field_name: "meme_resource_manager", kind: "Reference", value: "resource_rdx1t4" },
            { field_name: "total_minted", kind: "Decimal", value: "160" },
            { field_name: "total_burned", kind: "Decimal", value: "0" },
            { field_name: "paused", kind: "Bool", value: false },
          ],
        },
      },
    },
  ],
};

describe("parseXrdPerRoll", () => {
  it("reads the price out of a v2 component's state", () => {
    assert.equal(parseXrdPerRoll(v2Response("20")), 20);
  });

  it("reads a repriced value, not the default", () => {
    assert.equal(parseXrdPerRoll(v2Response("47.5")), 47.5);
  });

  it("returns null for a v1 component, which has no price field", () => {
    assert.equal(parseXrdPerRoll(V1_RESPONSE), null);
  });

  it("returns null when the field is not a Decimal — the layout moved", () => {
    assert.equal(parseXrdPerRoll(v2Response("20", "String")), null);
  });

  it("returns null outside the bounds the blueprint itself enforces", () => {
    assert.equal(parseXrdPerRoll(v2Response(String(MIN_XRD_PER_ROLL - 1))), null);
    assert.equal(parseXrdPerRoll(v2Response(String(MAX_XRD_PER_ROLL + 1))), null);
    assert.equal(parseXrdPerRoll(v2Response("0")), null);
    assert.equal(parseXrdPerRoll(v2Response("-20")), null);
  });

  it("accepts the exact bounds", () => {
    assert.equal(parseXrdPerRoll(v2Response(String(MIN_XRD_PER_ROLL))), MIN_XRD_PER_ROLL);
    assert.equal(parseXrdPerRoll(v2Response(String(MAX_XRD_PER_ROLL))), MAX_XRD_PER_ROLL);
  });

  it("returns null for unparseable and malformed responses", () => {
    assert.equal(parseXrdPerRoll(v2Response("not-a-number")), null);
    assert.equal(parseXrdPerRoll({ items: [] }), null);
    assert.equal(parseXrdPerRoll({}), null);
    assert.equal(parseXrdPerRoll(null), null);
    assert.equal(parseXrdPerRoll(undefined), null);
    assert.equal(parseXrdPerRoll("nonsense"), null);
  });
});

describe("getXrdPerRoll", () => {
  const originalWarn = console.warn;
  const originalInfo = console.info;

  beforeEach(() => {
    __resetVaultPriceCacheForTests();
    // The fallback paths log deliberately (a silent price fallback is the thing an
    // operator most needs told). Quieten them so the suite output stays readable.
    console.warn = () => {};
    console.info = () => {};
  });

  afterEach(() => {
    console.warn = originalWarn;
    console.info = originalInfo;
    __resetVaultPriceCacheForTests();
  });

  it("serves the config constant in phase 1, when there is no vault to ask", async () => {
    const price = await getXrdPerRoll({ component: "", fetchDetails: async () => {
      throw new Error("must not be called");
    } });
    assert.deepEqual(price, { value: XRD_PER_ROLL, source: "config" });
  });

  it("serves the component's price when the read succeeds", async () => {
    const price = await getXrdPerRoll({
      component: COMPONENT,
      fetchDetails: async () => v2Response("35"),
    });
    assert.deepEqual(price, { value: 35, source: "component" });
  });

  it("does not reject when the Gateway throws — it degrades to the constant", async () => {
    const price = await getXrdPerRoll({
      component: COMPONENT,
      fetchDetails: async () => {
        throw new Error("Gateway error: 503");
      },
    });
    assert.deepEqual(price, { value: XRD_PER_ROLL, source: "config" });
  });

  it("does not reject when the Gateway answers with something unreadable", async () => {
    const price = await getXrdPerRoll({
      component: COMPONENT,
      fetchDetails: async () => ({ items: [{ details: { state: null } }] }),
    });
    assert.deepEqual(price, { value: XRD_PER_ROLL, source: "config" });
  });

  it("caches within the TTL instead of re-reading per request", async () => {
    let calls = 0;
    const fetchDetails = async () => {
      calls++;
      return v2Response("35");
    };
    const at = 1_000_000;
    assert.equal((await getXrdPerRoll({ component: COMPONENT, fetchDetails, now: at })).value, 35);
    assert.equal((await getXrdPerRoll({ component: COMPONENT, fetchDetails, now: at + 30_000 })).value, 35);
    assert.equal(calls, 1, "second call inside the TTL must not hit the Gateway");
  });

  it("re-reads after the TTL expires", async () => {
    let calls = 0;
    const fetchDetails = async () => {
      calls++;
      return v2Response(calls === 1 ? "35" : "60");
    };
    const at = 1_000_000;
    assert.equal((await getXrdPerRoll({ component: COMPONENT, fetchDetails, now: at })).value, 35);
    const second = await getXrdPerRoll({ component: COMPONENT, fetchDetails, now: at + 120_000 });
    assert.deepEqual(second, { value: 60, source: "component" });
    assert.equal(calls, 2);
  });

  it("prefers a stale on-chain price to the compiled-in constant", async () => {
    let calls = 0;
    const fetchDetails = async () => {
      calls++;
      if (calls === 1) return v2Response("35");
      throw new Error("Gateway error: 503");
    };
    const at = 1_000_000;
    await getXrdPerRoll({ component: COMPONENT, fetchDetails, now: at });

    const stale = await getXrdPerRoll({ component: COMPONENT, fetchDetails, now: at + 120_000 });
    assert.deepEqual(
      stale,
      { value: 35, source: "component-stale" },
      "a price the component really had beats one the repo remembers"
    );
  });

  it("shares one in-flight read across concurrent misses", async () => {
    let calls = 0;
    const fetchDetails = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return v2Response("35");
    };
    const results = await Promise.all([
      getXrdPerRoll({ component: COMPONENT, fetchDetails }),
      getXrdPerRoll({ component: COMPONENT, fetchDetails }),
      getXrdPerRoll({ component: COMPONENT, fetchDetails }),
    ]);
    assert.equal(calls, 1, "three simultaneous misses must make one Gateway call");
    for (const r of results) assert.deepEqual(r, { value: 35, source: "component" });
  });
});

/**
 * The bounds above are tested RELATIVE to the constants, so they pass whatever the
 * constants say — which is why they stayed green while the constants drifted out of
 * sync with the blueprint they claim to mirror.
 *
 * PR #28 widened the blueprint rails to 0.001 / 1,000,000 and left this file at
 * 1 / 10,000. That inverts the guard: a price the owner had legitimately set to, say,
 * 0.5 XRD/ROLL would be read as out-of-range, discarded as a misparse, and silently
 * replaced by the compiled-in fallback — the shop quoting a price the vault had
 * stopped charging, which is the exact failure `xrd_per_roll_source` exists to expose.
 *
 * So this reads the blueprint and compares. A mirror that is not checked is a copy.
 */
describe("the TS mirrors match the blueprint's own rails", () => {
  // `__dirname`, not `import.meta.url`: this package compiles as commonjs
  // ("module": "commonjs" in tsconfig), where import.meta is a type error even
  // though tsx runs it happily. Typecheck is the thing that catches that, so the
  // path must work under the module system the project actually builds with.
  const BLUEPRINT = join(__dirname, "../../../../scrypto/meme-token/src/lib.rs");

  function constFromBlueprint(name: string): number {
    const src = readFileSync(BLUEPRINT, "utf8");
    // Matches both forms the blueprint uses: `const X: &str = "0.001";` (Decimals,
    // which must be strings in Scrypto) and `const X: i64 = 1_000_000;`.
    const m = new RegExp(`const\\s+${name}\\s*:\\s*(?:&str|i64)\\s*=\\s*"?([0-9_.]+)"?\\s*;`).exec(src);
    assert.ok(m, `could not find const ${name} in the blueprint — did it get renamed?`);
    return Number(m![1].replace(/_/g, ""));
  }

  it("MIN_XRD_PER_ROLL equals the blueprint's floor", () => {
    assert.equal(MIN_XRD_PER_ROLL, constFromBlueprint("MIN_XRD_PER_ROLL"));
  });

  it("MAX_XRD_PER_ROLL equals the blueprint's ceiling", () => {
    assert.equal(MAX_XRD_PER_ROLL, constFromBlueprint("MAX_XRD_PER_ROLL"));
  });

  it("the default price the server falls back to is one the blueprint would accept", () => {
    assert.ok(
      XRD_PER_ROLL >= MIN_XRD_PER_ROLL && XRD_PER_ROLL <= MAX_XRD_PER_ROLL,
      `phase-1 fallback ${XRD_PER_ROLL} sits outside the rails the blueprint enforces`
    );
    assert.equal(XRD_PER_ROLL, constFromBlueprint("DEFAULT_XRD_PER_ROLL"));
  });
});
