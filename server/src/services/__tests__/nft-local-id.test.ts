/**
 * Tests for buildNftLocalId.
 *
 * Regression: the minter passed the achievement key straight through as the
 * on-chain NonFungibleLocalId. String local ids are unique per resource, so
 * the first player to unlock "first_grid" would take that id forever and
 * every later player's mint would abort as a duplicate — silently capping the
 * whole collection at one NFT per achievement.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildNftLocalId } from "../nft-minter";

// Mirrors the blueprint's rule: 1-64 alphanumeric/underscore, else
// NonFungibleLocalId::string panics and the transaction fails.
const BLUEPRINT_RULE = /^[a-zA-Z0-9_]{1,64}$/;

describe("buildNftLocalId", () => {
  it("gives different players different ids for the same achievement", () => {
    const a = buildNftLocalId("first_grid", 42);
    const b = buildNftLocalId("first_grid", 87);
    assert.notEqual(a, b, "same id for two unlocks would abort the second mint");
    assert.equal(a, "first_grid_42");
    assert.equal(b, "first_grid_87");
  });

  it("is deterministic, so a retry re-mints the same id (never a duplicate NFT)", () => {
    assert.equal(buildNftLocalId("score_500", 7), buildNftLocalId("score_500", 7));
  });

  it("satisfies the blueprint charset/length rule for every catalog key", () => {
    for (const key of ["first_grid", "diamond_collector", "twentyfive_grids", "full_collection", "meme_lord"]) {
      const id = buildNftLocalId(key, 999999);
      assert.match(id, BLUEPRINT_RULE, `${id} would panic mint_nft`);
    }
  });

  it("keeps pathological keys inside the 64-char limit", () => {
    const id = buildNftLocalId("x".repeat(200), 12345);
    assert.ok(id.length <= 64, `length ${id.length} exceeds blueprint limit`);
    assert.match(id, BLUEPRINT_RULE);
    assert.ok(id.endsWith("_12345"), "uniqueness suffix must survive truncation");
  });

  it("sanitises characters the blueprint would reject", () => {
    const id = buildNftLocalId('bad-key."x', 3);
    assert.match(id, BLUEPRINT_RULE);
    assert.equal(id, "bad_key__x_3");
  });
});
