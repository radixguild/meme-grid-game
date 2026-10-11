/**
 * Tests for the deposit verifier (services/tx-verifier.ts).
 *
 * These call the real evaluateBuyRollsTransaction on Gateway-shaped
 * committed-details fixtures — no network. The earlier version of this file
 * re-implemented the vault check inline and asserted on its own copy, which is
 * how MG-1 (2026-10-06) went unpinned: the verifier credited any positive ROLLS
 * balance change, so ROLLS merely transferred into the account were credited
 * again alongside a one-roll mint.
 */
process.env.VAULT_COMPONENT = "";
process.env.MEME_RESOURCE = "";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateBuyRollsTransaction,
  verifyBuyMemeTransaction,
  parseDecimal,
} from "../tx-verifier";
import { MAINNET_ACCOUNTS } from "../../__tests__/fixtures/addresses";

// The verifier compares addresses as opaque strings (no decoding), so these
// component/resource ids are labels, not ledger addresses.
const VAULT = "component_test_vault";
const OTHER_COMPONENT = "component_test_attacker";
const ROLLS = "resource_test_rolls";
const XRD = "resource_rdx1tknxxxxxxxxxradxrdxxxxxxxxx009923554798xxxxxxxxxradxrd";
const PLAYER = MAINNET_ACCOUNTS[0];
const MULE = MAINNET_ACCOUNTS[1];
const CFG = { vaultComponent: VAULT, rollsResource: ROLLS, xrdResource: XRD };

function buyEvent(rolls: string, paid: string, emitterAddress = VAULT, moduleId = "Main") {
  return {
    name: "BuyRollsEvent",
    emitter: {
      type: "Method",
      entity: { is_global: true, entity_type: "GlobalGenericComponent", entity_address: emitterAddress },
      object_module_id: moduleId,
    },
    data: {
      kind: "Tuple",
      type_name: "BuyRollsEvent",
      fields: [
        { kind: "Decimal", field_name: "xrd_paid", value: paid },
        { kind: "Decimal", field_name: "rolls_amount", value: rolls },
        { kind: "Decimal", field_name: "change_returned", value: "0" },
      ],
    },
  };
}

function change(entity: string, resource: string, delta: string) {
  return { entity_address: entity, resource_address: resource, balance_change: delta };
}

function tx(events: unknown[] | undefined, changes: unknown[] | undefined, status = "CommittedSuccess") {
  return {
    transaction: {
      transaction_status: status,
      affected_global_entities: [VAULT, PLAYER, ROLLS, XRD],
      receipt: events === undefined ? {} : { events },
      balance_changes: changes === undefined ? undefined : { fungible_balance_changes: changes },
    },
  };
}

describe("tx-verifier: credit only what the transaction minted for this payer (MG-1)", () => {
  it("credits a plain mint: the event amount, paid in XRD by the credited account", () => {
    const r = evaluateBuyRollsTransaction(
      tx([buyEvent("10", "1")], [
        change(PLAYER, XRD, "-1.35"), // 1 XRD price + fee
        change(PLAYER, ROLLS, "10"),
        change(VAULT, XRD, "1"),
      ]),
      PLAYER,
      CFG
    );
    assert.equal(r.valid, true, r.error);
    assert.equal(r.memeAmount, 10);
    assert.equal(r.xrdAmount, "1");
  });

  it("refuses a recycle tx: +1000 ROLLS on the account but only 1 minted", () => {
    // 999 ROLLS withdrawn from a second wallet + a one-roll buy, all deposited
    // into PLAYER. The old verifier credited 1000 here.
    const r = evaluateBuyRollsTransaction(
      tx([buyEvent("1", "0.001")], [
        change(MULE, ROLLS, "-999"),
        change(MULE, XRD, "-0.5"),
        change(PLAYER, ROLLS, "1000"),
        change(VAULT, XRD, "0.001"),
      ]),
      PLAYER,
      CFG
    );
    assert.equal(r.valid, false);
    assert.equal(r.memeAmount, 0);
    assert.match(r.error!, /does not equal/);
  });

  it("refuses a transfer-only tx that touches the vault but mints nothing", () => {
    const r = evaluateBuyRollsTransaction(
      tx([], [change(MULE, ROLLS, "-1000"), change(PLAYER, ROLLS, "1000"), change(VAULT, XRD, "0.001")]),
      PLAYER,
      CFG
    );
    assert.equal(r.valid, false);
    assert.equal(r.memeAmount, 0);
    assert.match(r.error!, /did not mint/);
  });

  it("refuses when another account paid for the mint", () => {
    const r = evaluateBuyRollsTransaction(
      tx([buyEvent("10", "1")], [
        change(MULE, XRD, "-1.3"),
        change(PLAYER, XRD, "-0.3"), // PLAYER paid only the fee
        change(PLAYER, ROLLS, "10"),
      ]),
      PLAYER,
      CFG
    );
    assert.equal(r.valid, false);
    assert.match(r.error!, /less than/);
  });

  it("ignores a BuyRollsEvent emitted by someone else's component", () => {
    const r = evaluateBuyRollsTransaction(
      tx([buyEvent("1000", "0.001", OTHER_COMPONENT)], [
        change(PLAYER, XRD, "-0.5"),
        change(PLAYER, ROLLS, "1000"),
      ]),
      PLAYER,
      CFG
    );
    assert.equal(r.valid, false);
    assert.match(r.error!, /did not mint/);
  });

  it("ignores a same-named event from a non-Main module of the vault", () => {
    const r = evaluateBuyRollsTransaction(
      tx([buyEvent("10", "1", VAULT, "Metadata")], [change(PLAYER, XRD, "-2"), change(PLAYER, ROLLS, "10")]),
      PLAYER,
      CFG
    );
    assert.equal(r.valid, false);
  });

  it("sums several vault mints in one transaction", () => {
    const r = evaluateBuyRollsTransaction(
      tx([buyEvent("3", "0.3"), buyEvent("7", "0.7")], [change(PLAYER, XRD, "-1.2"), change(PLAYER, ROLLS, "10")]),
      PLAYER,
      CFG
    );
    assert.equal(r.valid, true, r.error);
    assert.equal(r.memeAmount, 10);
    assert.equal(r.xrdAmount, "1");
  });

  it("fails closed when receipt events or balance changes are missing", () => {
    const noEvents = evaluateBuyRollsTransaction(tx(undefined, [change(PLAYER, ROLLS, "10")]), PLAYER, CFG);
    assert.equal(noEvents.valid, false);
    assert.match(noEvents.error!, /receipt events unavailable/);

    const noChanges = evaluateBuyRollsTransaction(tx([buyEvent("10", "1")], undefined), PLAYER, CFG);
    assert.equal(noChanges.valid, false);
    assert.match(noChanges.error!, /balance changes unavailable/);
  });

  it("fails closed on an unreadable event field or balance change", () => {
    const badEvent = buyEvent("10", "1");
    (badEvent.data.fields[1] as { value: string }).value = "ten";
    const r1 = evaluateBuyRollsTransaction(
      tx([badEvent], [change(PLAYER, XRD, "-2"), change(PLAYER, ROLLS, "10")]),
      PLAYER,
      CFG
    );
    assert.equal(r1.valid, false);

    const r2 = evaluateBuyRollsTransaction(
      tx([buyEvent("10", "1")], [change(PLAYER, XRD, "-2"), change(PLAYER, ROLLS, "1e1")]),
      PLAYER,
      CFG
    );
    assert.equal(r2.valid, false);
  });

  it("refuses a non-committed transaction", () => {
    const r = evaluateBuyRollsTransaction(
      tx([buyEvent("10", "1")], [change(PLAYER, XRD, "-2"), change(PLAYER, ROLLS, "10")], "CommittedFailure"),
      PLAYER,
      CFG
    );
    assert.equal(r.valid, false);
    assert.match(r.error!, /CommittedFailure/);
  });

  it("parses Radix Decimals exactly (no float rounding in the payer check)", () => {
    assert.equal(parseDecimal("0.000000000000000001"), 1n);
    assert.equal(parseDecimal("-1.5"), -1500000000000000000n);
    assert.equal(parseDecimal("1e3"), null);
    assert.equal(parseDecimal(12 as unknown), null);
    // A debit exactly equal to the price passes — no 0.1+0.2 float drift.
    const r = evaluateBuyRollsTransaction(
      tx([buyEvent("3", "0.3")], [change(PLAYER, XRD, "-0.3"), change(PLAYER, ROLLS, "3")]),
      PLAYER,
      CFG
    );
    assert.equal(r.valid, true, r.error);
  });
});

describe("tx-verifier: Phase 1 (no vault configured)", () => {
  it("returns invalid without any Gateway call", async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("fetch must not be called in Phase 1");
    }) as typeof fetch;
    try {
      const r = await verifyBuyMemeTransaction("txid_rdx1qanything", PLAYER);
      assert.equal(r.valid, false);
      assert.match(r.error!, /not configured/i);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
