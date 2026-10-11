/**
 * NFT prize-pool resource allowlist (docs/PROJECT-STATE.md item 16, step 2).
 * The property that matters: it fails CLOSED — no env, no prizes.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  getPrizeResourceAllowlist,
  isAllowedPrizeResource,
  filterAllowedPrizeCollections,
  assertAllowedPrizeResources,
} from "../prize-allowlist";
import { MAINNET_RESOURCE } from "../../__tests__/fixtures/addresses";

// Shape-plausible only; the allowlist compares strings and never decodes them.
const OTHER_PRIZE = "resource_rdx1ntprizeotherexample0000000000000000000000000000000000000";
const BADGE = "resource_rdx1ntownerbadgeexample00000000000000000000000000000000000000";

describe("prize-allowlist", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env.NFT_PRIZE_RESOURCE_ALLOWLIST;
    delete process.env.NFT_PRIZE_RESOURCE_ALLOWLIST;
  });

  afterEach(() => {
    if (saved === undefined) delete process.env.NFT_PRIZE_RESOURCE_ALLOWLIST;
    else process.env.NFT_PRIZE_RESOURCE_ALLOWLIST = saved;
  });

  it("unset env allows nothing", () => {
    assert.equal(getPrizeResourceAllowlist().size, 0);
    assert.equal(isAllowedPrizeResource(MAINNET_RESOURCE), false);
    assert.equal(isAllowedPrizeResource(""), false);
  });

  it("empty env allows nothing", () => {
    process.env.NFT_PRIZE_RESOURCE_ALLOWLIST = "";
    assert.equal(getPrizeResourceAllowlist().size, 0);
    assert.equal(isAllowedPrizeResource(MAINNET_RESOURCE), false);
  });

  it("a comma-separated list allows exactly the listed addresses", () => {
    process.env.NFT_PRIZE_RESOURCE_ALLOWLIST = `${MAINNET_RESOURCE},${OTHER_PRIZE}`;
    assert.deepEqual([...getPrizeResourceAllowlist()], [MAINNET_RESOURCE, OTHER_PRIZE]);
    assert.equal(isAllowedPrizeResource(MAINNET_RESOURCE), true);
    assert.equal(isAllowedPrizeResource(OTHER_PRIZE), true);
    assert.equal(isAllowedPrizeResource(BADGE), false);
  });

  it("trims whitespace and drops empty entries", () => {
    process.env.NFT_PRIZE_RESOURCE_ALLOWLIST = `  ${MAINNET_RESOURCE} , ,${OTHER_PRIZE}  ,`;
    assert.deepEqual([...getPrizeResourceAllowlist()], [MAINNET_RESOURCE, OTHER_PRIZE]);
    assert.equal(isAllowedPrizeResource(""), false);
    assert.equal(isAllowedPrizeResource(" "), false);
  });

  it("does not case-fold", () => {
    process.env.NFT_PRIZE_RESOURCE_ALLOWLIST = MAINNET_RESOURCE;
    assert.equal(isAllowedPrizeResource(MAINNET_RESOURCE.toUpperCase()), false);
  });

  it("filterAllowedPrizeCollections keeps only allowed items, in order, untouched", () => {
    process.env.NFT_PRIZE_RESOURCE_ALLOWLIST = `${OTHER_PRIZE},${MAINNET_RESOURCE}`;
    const holdings = [
      { resource_address: MAINNET_RESOURCE, count: 3, name: "Gift A", icon_url: "https://a/icon.png" },
      { resource_address: BADGE, count: 1, name: "Owner Badge", icon_url: null },
      { resource_address: OTHER_PRIZE, count: 7, name: null, icon_url: null },
    ];
    const out = filterAllowedPrizeCollections(holdings);
    assert.deepEqual(out, [holdings[0], holdings[2]]);
    assert.equal(out[0], holdings[0]);
    assert.equal(out.reduce((s, c) => s + c.count, 0), 10);
  });

  it("filterAllowedPrizeCollections returns nothing when the allowlist is unset", () => {
    const holdings = [{ resource_address: MAINNET_RESOURCE, count: 1, name: null, icon_url: null }];
    assert.deepEqual(filterAllowedPrizeCollections(holdings), []);
  });

  it("assertAllowedPrizeResources throws naming every disallowed address", () => {
    process.env.NFT_PRIZE_RESOURCE_ALLOWLIST = MAINNET_RESOURCE;
    assert.throws(
      () => assertAllowedPrizeResources([MAINNET_RESOURCE, BADGE, OTHER_PRIZE]),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes(BADGE));
        assert.ok(err.message.includes(OTHER_PRIZE));
        assert.ok(!err.message.includes(MAINNET_RESOURCE));
        return true;
      },
    );
  });

  it("assertAllowedPrizeResources is a no-op on empty and all-allowed lists", () => {
    assert.doesNotThrow(() => assertAllowedPrizeResources([]));
    process.env.NFT_PRIZE_RESOURCE_ALLOWLIST = `${MAINNET_RESOURCE},${OTHER_PRIZE}`;
    assert.doesNotThrow(() => assertAllowedPrizeResources([MAINNET_RESOURCE, OTHER_PRIZE]));
  });

  it("assertAllowedPrizeResources throws on any address when the allowlist is unset", () => {
    assert.throws(() => assertAllowedPrizeResources([MAINNET_RESOURCE]), /not in NFT_PRIZE_RESOURCE_ALLOWLIST/);
  });
});
