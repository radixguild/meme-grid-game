import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NFT_CATALOG,
  OBTAINABLE_NFTS,
  OBTAINABLE_NFT_COUNT,
  UNOBTAINABLE_NFTS,
  EVALUABLE_STAT_FIELDS,
  isObtainable,
  parseThresholdCondition,
} from "../nfts";

// The catalog advertises 23 NFTs, but the award engine can only grant 13 of
// them. These tests pin BOTH numbers so nobody can quietly go back to
// advertising "collect all 23" — and so that implementing a missing unlock
// condition forces a deliberate update here.

describe("NFT obtainability", () => {
  it("has 23 NFTs in the catalog", () => {
    assert.equal(NFT_CATALOG.length, 23);
  });

  it("only 13 of them can actually be earned today", () => {
    assert.equal(OBTAINABLE_NFT_COUNT, 13);
    assert.equal(OBTAINABLE_NFTS.length, 13);
    assert.equal(UNOBTAINABLE_NFTS.length, 10);
    assert.equal(OBTAINABLE_NFTS.length + UNOBTAINABLE_NFTS.length, NFT_CATALOG.length);
  });

  it("names exactly the 13 earnable NFTs", () => {
    assert.deepEqual(
      OBTAINABLE_NFTS.map((n) => n.key).sort(),
      [
        "dice_novice",
        "fifty_grids",
        "first_grid",
        "five_grids",
        "hundred_grids",
        "meme_lord",
        "rolls_500",
        "score_100",
        "score_200",
        "score_300",
        "score_500",
        "ten_grids",
        "twentyfive_grids",
      ]
    );
  });

  it("names exactly the 10 unreachable NFTs", () => {
    assert.deepEqual(
      UNOBTAINABLE_NFTS.map((n) => n.key).sort(),
      [
        "diamond_collector",
        "extra_master",
        "full_collection",
        "moon_shot",
        "no_rug",
        "perfect_board",
        "rug_survivor",
        "speed_runner",
        "streak_7",
        "wild_user",
      ]
    );
  });

  it("treats every `special:` condition as unreachable — nothing implements them", () => {
    const specials = NFT_CATALOG.filter((n) => n.unlockCondition.startsWith("special:"));
    assert.equal(specials.length, 4);
    for (const nft of specials) {
      assert.equal(isObtainable(nft), false, `${nft.key} should be unobtainable`);
      assert.equal(parseThresholdCondition(nft.unlockCondition), null);
    }
  });

  it("treats thresholds on never-computed stats as unreachable", () => {
    const uncomputed = ["rug_pulls_hit", "extra_turns_earned", "wild_cards_used", "streak_days", "diamonds_completed", "moons_completed"];
    for (const field of uncomputed) {
      assert.ok(
        !(EVALUABLE_STAT_FIELDS as readonly string[]).includes(field),
        `${field} is not computed, so it must not be listed as evaluable`
      );
    }
    const blocked = NFT_CATALOG.filter((n) => {
      const p = parseThresholdCondition(n.unlockCondition);
      return p !== null && uncomputed.includes(p.field);
    });
    assert.equal(blocked.length, 6);
    for (const nft of blocked) assert.equal(isObtainable(nft), false);
  });

  it("every obtainable NFT thresholds on a stat the award engine is given", () => {
    for (const nft of OBTAINABLE_NFTS) {
      const parsed = parseThresholdCondition(nft.unlockCondition);
      assert.ok(parsed, `${nft.key} must parse as a threshold condition`);
      assert.ok(
        (EVALUABLE_STAT_FIELDS as readonly string[]).includes(parsed!.field),
        `${nft.key} thresholds on unknown stat ${parsed!.field}`
      );
    }
  });

  it("parses threshold conditions the same way the award engine does", () => {
    assert.deepEqual(parseThresholdCondition("grids_completed >= 25"), {
      field: "grids_completed",
      value: 25,
    });
    assert.equal(parseThresholdCondition("special:perfect_board"), null);
    assert.equal(parseThresholdCondition("grids_completed > 25"), null);
    assert.equal(parseThresholdCondition("nonsense"), null);
  });
});
