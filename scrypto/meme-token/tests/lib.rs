//! Integration tests for the meme-game-vault blueprint (Scrypto 1.3, scrypto-test).
//!
//! Run on Linux: `cd scrypto && cargo test -p meme-token` (WASM build is Linux-only).
//!
//! These pin the pre-audit fixes (scrypto-audit-kit/trial-reports/meme-game-vault-*.json):
//!   - buy_rolls prices off component STATE (xrd_per_roll), MIN/MAX bounds enforced.
//!   - F-005: checked_mul at MAX_XRD does not overflow (boundary buy succeeds).
//!   - F-001 / Branch A: withdraw_xrd is owner-badge-gated (revenue, not custody).
//!   - burn_rolls reduces circulating supply.
//!   - pause blocks buys.
//!
//! ── v2 (badge split) ────────────────────────────────────────────────────
//! v2 mints TWO owner badges and ONE separate admin badge, and moves
//! `withdraw_xrd` to OWNER-only. The tests below pin that split directly:
//! `admin_can_pause_but_cannot_withdraw` is the one that fails if anyone ever
//! re-adds `admin` to the `withdraw_xrd` auth rule, and
//! `owner_badge_supply_is_two` is the one that fails if the second owner badge
//! is dropped. See the "Why there is a v2" comment in `src/lib.rs`.
//!
//! Addresses are read back from the component (`get_badges`, `get_rolls_resource`)
//! rather than indexed out of `new_resource_addresses()`, so reordering the
//! resource creation inside `instantiate()` can no longer silently point a test
//! at the wrong resource — which is exactly what the old `resources[1]` index did
//! the moment v2 inserted the admin badge ahead of ROLLS.
//!
//! ── Recovery note (2026-08-13, resolved 2026-08-21) ─────────────────────
//! Recovered via `git show f7eaf71:docs/drafts/nft-drops-vps-2026-07-24/scrypto-meme-token--tests--lib.rs`
//! from branch `vps-claude/wip-2026-08-04` (that branch has unrelated git history and was never
//! merged; do not merge or diff it directly).
//!
//! The caveat that used to sit here — "never compiled, and no CI job runs `cargo test` for this
//! workspace" — is spent: `.github/workflows/ci.yml` now has a `scrypto` job that builds the wasm
//! and runs these tests on Linux, and they pass. A green result here means something. It still
//! means nothing LOCALLY on macOS, which cannot build these at all (`blst` will not compile for
//! wasm32); `cargo check -p meme-token` remains the most a Mac can say.

use scrypto::prelude::*;
use scrypto_test::prelude::*;

struct Test {
    ledger: DefaultLedgerSimulator,
    pk: Secp256k1PublicKey,
    account: ComponentAddress,
    component: ComponentAddress,
    owner_badge: ResourceAddress,
    admin_badge: ResourceAddress,
    rolls: ResourceAddress,
    /// The vault's price at instantiate, read from the component rather than copied
    /// from DEFAULT_XRD_PER_ROLL. Every amount below is expressed as a multiple of
    /// this, because the default is a LAUNCH SETTING that is expected to move — it
    /// has already gone 1 -> 20 -> 35. Tests that hardcode "100 XRD buys 5 ROLLS"
    /// encode a business decision as a correctness invariant and break every time
    /// the price is tuned, which teaches people to edit tests to match the code.
    price: Decimal,
}

fn setup() -> Test {
    let mut ledger = LedgerSimulatorBuilder::new().build();
    let (pk, _sk, account) = ledger.new_allocated_account();
    finish_setup(ledger, pk, account)
}

/// `setup()`, but the test account is funded with `xrd` XRD **at genesis**.
///
/// `new_allocated_account` funds exactly 10,000 XRD, so any test that needs to
/// spend near MAX_XRD (1,000,000) through it would need ~101
/// `load_account_from_faucet` calls — which tests the faucet's patience, not the
/// blueprint. `single_validator_and_staker` takes the staker account's XRD grant
/// as an argument, so the whole balance arrives in the genesis receipt: no faucet
/// loop, no extra transactions, and the purchase under test is the only thing
/// happening. `faucet_supply` is still the default testing supply on this path,
/// so `lock_fee_from_faucet` keeps working.
fn setup_funded(xrd: Decimal) -> Test {
    let pk = Secp256k1PrivateKey::from_u64(999_001).unwrap().public_key();
    let account = ComponentAddress::preallocated_account_from_public_key(&pk);
    let genesis = BabylonSettings::single_validator_and_staker(
        pk,
        Decimal::one(),
        xrd,
        account,
        Epoch::of(1),
        ConsensusManagerConfig::test_default(),
    );
    let ledger = LedgerSimulatorBuilder::new()
        .with_custom_genesis(genesis)
        .build();
    finish_setup(ledger, pk, account)
}

fn finish_setup(
    mut ledger: DefaultLedgerSimulator,
    pk: Secp256k1PublicKey,
    account: ComponentAddress,
) -> Test {
    let package = ledger.compile_and_publish(this_package!());

    let manifest = ManifestBuilder::new()
        .lock_fee_from_faucet()
        .call_function(
            package,
            "MemeGameVault",
            "instantiate",
            manifest_args!(GlobalAddress::from(account)),
        )
        // instantiate returns (component, owner_badges, admin_badge) — three
        // buckets. The tests deposit all of them into the single test account;
        // a REAL deploy manifest must not (see the instantiate doc comment).
        .try_deposit_entire_worktop_or_abort(account, None)
        .build();
    let receipt = ledger.execute_manifest(manifest, vec![NonFungibleGlobalId::from_public_key(&pk)]);
    let commit = receipt.expect_commit_success();

    let component = commit.new_component_addresses()[0];

    // Ask the component which resources are which, rather than assuming an order.
    let query = ManifestBuilder::new()
        .lock_fee_from_faucet()
        .call_method(component, "get_badges", manifest_args!())
        .call_method(component, "get_rolls_resource", manifest_args!())
        .call_method(component, "get_price", manifest_args!())
        .build();
    let query_receipt =
        ledger.execute_manifest(query, vec![NonFungibleGlobalId::from_public_key(&pk)]);
    let query_commit = query_receipt.expect_commit_success();
    let (owner_badge, admin_badge) = query_commit.output::<(ResourceAddress, ResourceAddress)>(1);
    let rolls = query_commit.output::<ResourceAddress>(2);
    let price = query_commit.output::<Decimal>(3);

    Test {
        pk,
        account,
        component,
        owner_badge,
        admin_badge,
        rolls,
        price,
        ledger,
    }
}

/// buy_rolls with `xrd` XRD from the funded account. Returns the receipt.
fn buy(t: &mut Test, xrd: Decimal) -> TransactionReceipt {
    let manifest = ManifestBuilder::new()
        .lock_fee_from_faucet()
        .withdraw_from_account(t.account, XRD, xrd)
        .take_all_from_worktop(XRD, "payment")
        .call_method_with_name_lookup(t.component, "buy_rolls", |lookup| {
            manifest_args!(lookup.bucket("payment"))
        })
        .try_deposit_entire_worktop_or_abort(t.account, None)
        .build();
    t.ledger
        .execute_manifest(manifest, vec![NonFungibleGlobalId::from_public_key(&t.pk)])
}

/// XRD held by the vault.
fn treasury(t: &mut Test) -> Decimal {
    let manifest = ManifestBuilder::new()
        .lock_fee_from_faucet()
        .call_method(t.component, "get_treasury", manifest_args!())
        .build();
    let receipt = t
        .ledger
        .execute_manifest(manifest, vec![NonFungibleGlobalId::from_public_key(&t.pk)]);
    receipt.expect_commit_success().output::<Decimal>(1)
}

/// (total_minted, total_burned, circulating)
fn stats(t: &mut Test) -> (Decimal, Decimal, Decimal) {
    let manifest = ManifestBuilder::new()
        .lock_fee_from_faucet()
        .call_method(t.component, "get_stats", manifest_args!())
        .build();
    let receipt = t
        .ledger
        .execute_manifest(manifest, vec![NonFungibleGlobalId::from_public_key(&t.pk)]);
    receipt
        .expect_commit_success()
        .output::<(Decimal, Decimal, Decimal)>(1)
}

/// Call `method` with `args`, presenting a proof of one `badge`.
fn call_with_badge(
    t: &mut Test,
    badge: ResourceAddress,
    method: &str,
    args: impl ResolvableArguments,
) -> TransactionReceipt {
    let manifest = ManifestBuilder::new()
        .lock_fee_from_faucet()
        .create_proof_from_account_of_amount(t.account, badge, dec!(1))
        .call_method(t.component, method, args)
        .try_deposit_entire_worktop_or_abort(t.account, None)
        .build();
    t.ledger
        .execute_manifest(manifest, vec![NonFungibleGlobalId::from_public_key(&t.pk)])
}

#[test]
fn buy_mints_at_the_current_price() {
    let mut t = setup();
    let p = t.price;
    buy(&mut t, p * dec!(5)).expect_commit_success();

    assert_eq!(
        t.ledger.get_component_balance(t.account, t.rolls),
        dec!(5),
        "five ROLLS' worth of XRD should mint exactly five ROLLS"
    );
    let (minted, _burned, circulating) = stats(&mut t);
    assert_eq!(minted, dec!(5));
    assert_eq!(circulating, dec!(5));
    assert_eq!(
        treasury(&mut t),
        p * dec!(5),
        "an exact-multiple payment leaves no change, so all of it is treasury"
    );
}

/// The case that had NO coverage, and the one the price rise made reachable: a
/// payment that is not a whole multiple of the price.
///
/// Every other buy test uses an exact multiple (100/20, 1000/20, 10000/20), so
/// `buy_rolls` putting the ENTIRE payment into the treasury and returning only the
/// floored ROLLS was invisible — it kept up to 19 of every 20 XRD on a non-multiple
/// purchase and nothing asserted otherwise. The shop's XRD field is free text, so
/// this is an ordinary purchase, not a crafted one.
#[test]
fn change_is_returned_when_the_payment_is_not_a_multiple_of_the_price() {
    let mut t = setup();
    let p = t.price;
    let before = t.ledger.get_component_balance(t.account, XRD);

    // Two ROLLS' worth plus half a ROLL: buys 2, and the half must come back.
    buy(&mut t, p * dec!(2) + p / dec!(2)).expect_commit_success();

    assert_eq!(t.ledger.get_component_balance(t.account, t.rolls), dec!(2));
    assert_eq!(
        before - t.ledger.get_component_balance(t.account, XRD),
        p * dec!(2),
        "the buyer must be out only what the 2 ROLLS actually cost"
    );
    assert_eq!(
        treasury(&mut t),
        p * dec!(2),
        "the vault must keep only what it sold"
    );
}

/// The price is STATE, not a constant — that is the whole point of v2's buy rail.
/// Repricing must change what the next purchase yields, without a redeploy.
#[test]
fn owner_can_reprice_and_it_takes_effect() {
    let mut t = setup();
    let badge = t.owner_badge;

    // Deliberately hardcoded, unlike every other amount in this file: this test sets
    // the price itself, so the numbers are its own and do not track the launch
    // default. Do not "fix" them to use t.price — that would test nothing.
    call_with_badge(&mut t, badge, "set_price", manifest_args!(dec!(50)))
        .expect_commit_success();

    buy(&mut t, dec!(100)).expect_commit_success();
    assert_eq!(
        t.ledger.get_component_balance(t.account, t.rolls),
        dec!(2),
        "after repricing to 50 XRD/ROLL, 100 XRD should mint 2 ROLLS"
    );
}

/// Repricing is owner-only. The warm admin badge can stop trading; it must not be
/// able to decide what players pay.
#[test]
fn admin_cannot_reprice() {
    let mut t = setup();
    let admin = t.admin_badge;
    call_with_badge(&mut t, admin, "set_price", manifest_args!(dec!(50)))
        .expect_commit_failure();
}

/// "Owner-settable" must not mean "settable to anything". A zero rate would mint
/// ROLLS for nothing; the bounds are enforced in the blueprint, not the client.
#[test]
fn price_is_bounded() {
    let mut t = setup();
    let badge = t.owner_badge;

    call_with_badge(&mut t, badge, "set_price", manifest_args!(dec!(0)))
        .expect_commit_failure();
    call_with_badge(&mut t, badge, "set_price", manifest_args!(dec!("0.0009")))
        .expect_commit_failure();
    call_with_badge(&mut t, badge, "set_price", manifest_args!(dec!(1_000_001)))
        .expect_commit_failure();

    // ...and the rails themselves are reachable. A bound nobody can actually set is
    // an off-by-one waiting to be found during an incident.
    call_with_badge(&mut t, badge, "set_price", manifest_args!(dec!("0.001")))
        .expect_commit_success();
    call_with_badge(&mut t, badge, "set_price", manifest_args!(dec!(1_000_000)))
        .expect_commit_success();
}

/// A payment too small to buy a whole ROLL is rejected outright rather than
/// silently taking the XRD and minting zero.
#[test]
fn purchase_below_one_roll_is_rejected() {
    let mut t = setup();
    let p = t.price;
    // Half a ROLL's worth floors to 0 ROLLS.
    buy(&mut t, p / dec!(2)).expect_commit_failure();
}

/// The effective minimum purchase must TRACK the price, not sit at a fixed number
/// of XRD.
///
/// MIN_XRD used to be 1 XRD. That is harmless at 35 XRD/ROLL and wrong at a low
/// price: with the rate set to 0.001, a 1 XRD floor would have forced a minimum
/// purchase of a thousand ROLLS. A fixed XRD floor cannot sit above a variable XRD
/// price without eventually colliding with it, so MIN_XRD is now a dust guard and
/// the real minimum is "enough for one whole ROLL", which moves with `set_price`.
#[test]
fn the_minimum_purchase_follows_the_price() {
    let mut t = setup();

    // At the launch rate, 0.5 XRD buys nothing and is rejected.
    buy(&mut t, dec!("0.5")).expect_commit_failure();

    // Repriced low, that same 0.5 XRD is a perfectly good purchase. Under the old
    // fixed 1 XRD floor it would still have failed.
    let badge = t.owner_badge;
    call_with_badge(&mut t, badge, "set_price", manifest_args!(dec!("0.001")))
        .expect_commit_success();
    buy(&mut t, dec!("0.5")).expect_commit_success();
    assert_eq!(
        t.ledger.get_component_balance(t.account, t.rolls),
        dec!(500),
        "0.5 XRD at 0.001 XRD/ROLL is 500 ROLLS"
    );
}

/// F-005: a large purchase must not overflow the price arithmetic.
///
/// ⚠️ This is NOT the MAX_XRD boundary. `new_allocated_account` funds exactly
/// 10,000 XRD and MAX_XRD is 1,000,000, so genuinely testing the upper bound would
/// mean ~101 `load_account_from_faucet` calls to fund the account — a slow test
/// resting on the simulator faucet being unlimited. The upper bound is a three-line
/// assert on a value the arithmetic cannot reach (`cost <= payment` by
/// construction, and Decimal's range is ~5.7e28), so the trade is deliberate.
/// Stated here rather than left to look like coverage that exists.
#[test]
fn a_large_purchase_succeeds() {
    let mut t = setup();
    let p = t.price;
    buy(&mut t, dec!(10000)).expect_commit_success();
    let expected = (dec!(10000) / p).checked_floor().unwrap();
    assert_eq!(t.ledger.get_component_balance(t.account, t.rolls), expected);
}

#[test]
fn burn_reduces_circulating_supply() {
    let mut t = setup();
    let p = t.price;
    buy(&mut t, p * dec!(50)).expect_commit_success(); // 50 ROLLS

    let manifest = ManifestBuilder::new()
        .lock_fee_from_faucet()
        .withdraw_from_account(t.account, t.rolls, dec!(40))
        .take_all_from_worktop(t.rolls, "to_burn")
        .call_method_with_name_lookup(t.component, "burn_rolls", |lookup| {
            manifest_args!(lookup.bucket("to_burn"))
        })
        .build();
    t.ledger
        .execute_manifest(manifest, vec![NonFungibleGlobalId::from_public_key(&t.pk)])
        .expect_commit_success();

    let (_minted, burned, circulating) = stats(&mut t);
    assert_eq!(burned, dec!(40));
    assert_eq!(circulating, dec!(10));
}

/// F-001 / Branch A: withdraw_xrd is owner-only. A caller with no badge fails.
#[test]
fn withdraw_xrd_requires_owner_badge() {
    let mut t = setup();
    let p = t.price;
    buy(&mut t, p * dec!(5)).expect_commit_success(); // fund the treasury

    let (stranger_pk, _sk, _stranger) = t.ledger.new_allocated_account();
    let manifest = ManifestBuilder::new()
        .lock_fee_from_faucet()
        .call_method(t.component, "withdraw_xrd", manifest_args!(dec!(10)))
        .try_deposit_entire_worktop_or_abort(t.account, None)
        .build();
    let receipt = t
        .ledger
        .execute_manifest(manifest, vec![NonFungibleGlobalId::from_public_key(&stranger_pk)]);

    receipt.expect_commit_failure();
}

/// Branch A: the owner CAN withdraw revenue with the badge.
#[test]
fn owner_can_withdraw_xrd() {
    let mut t = setup();
    let p = t.price;
    buy(&mut t, p * dec!(5)).expect_commit_success();

    let badge = t.owner_badge;
    call_with_badge(&mut t, badge, "withdraw_xrd", manifest_args!(p * dec!(2)))
        .expect_commit_success();
}

/// A zero or negative withdrawal is rejected outright rather than emitting a
/// no-op TreasuryWithdrawEvent.
#[test]
fn withdraw_zero_is_rejected() {
    let mut t = setup();
    let p = t.price;
    buy(&mut t, p * dec!(5)).expect_commit_success();

    let badge = t.owner_badge;
    call_with_badge(&mut t, badge, "withdraw_xrd", manifest_args!(dec!(0)))
        .expect_commit_failure();
}

/// v2's whole point: the WARM badge can stop trading but cannot touch funds.
/// If this test starts passing on the withdraw half, the badge split is gone.
#[test]
fn admin_can_pause_but_cannot_withdraw() {
    let mut t = setup();
    let p = t.price;
    buy(&mut t, p * dec!(5)).expect_commit_success(); // fund the treasury

    let admin = t.admin_badge;
    call_with_badge(&mut t, admin, "set_paused", manifest_args!(true))
        .expect_commit_success();

    call_with_badge(&mut t, admin, "withdraw_xrd", manifest_args!(p))
        .expect_commit_failure();
}

/// Two owner badges exist so cold custody and a backup can live under separate
/// key material. A supply of 1 here means v1's single point of failure is back.
#[test]
fn owner_badge_supply_is_two() {
    let mut t = setup();
    assert_eq!(
        t.ledger.get_component_balance(t.account, t.owner_badge),
        dec!(2),
        "instantiate must mint TWO owner badges"
    );
    assert_eq!(
        t.ledger.get_component_balance(t.account, t.admin_badge),
        dec!(1),
        "instantiate must mint exactly one admin badge"
    );
    assert_ne!(
        t.owner_badge, t.admin_badge,
        "owner and admin must be distinct resources"
    );
}

/// Paused vault rejects buys.
///
/// The amount matters. This used to buy a flat 10 XRD, which floors to zero ROLLS
/// and is rejected by `buy_rolls`'s own minimum check whether the vault is paused or
/// not — so the test passed for the wrong reason and would have kept passing if
/// `set_paused` stopped gating buys entirely. Five ROLLS' worth is a purchase that
/// succeeds when unpaused (`buy_mints_at_the_current_price` proves it), so the only
/// thing that can fail it here is the pause.
#[test]
fn paused_blocks_buy() {
    let mut t = setup();
    let p = t.price;

    let badge = t.owner_badge;
    call_with_badge(&mut t, badge, "set_paused", manifest_args!(true))
        .expect_commit_success();

    buy(&mut t, p * dec!(5)).expect_commit_failure();
}

/// ROLLS may only be burned BY the component. A holder burning them straight off
/// the resource would emit no `BurnRollsEvent` and never reach `total_burned`, so
/// the server would credit nothing and `circulating` would overstate supply forever.
/// The burn role is `global_caller`, so the ledger refuses it outright.
#[test]
fn direct_burn_outside_the_component_is_denied() {
    let mut t = setup();
    let p = t.price;
    buy(&mut t, p * dec!(5)).expect_commit_success(); // 5 ROLLS

    let manifest = ManifestBuilder::new()
        .lock_fee_from_faucet()
        .withdraw_from_account(t.account, t.rolls, dec!(1))
        .burn_from_worktop(dec!(1), t.rolls)
        .build();
    t.ledger
        .execute_manifest(manifest, vec![NonFungibleGlobalId::from_public_key(&t.pk)])
        .expect_commit_failure();

    // and burning THROUGH the component still works, so this restricts nothing real
    let via_component = ManifestBuilder::new()
        .lock_fee_from_faucet()
        .withdraw_from_account(t.account, t.rolls, dec!(1))
        .take_all_from_worktop(t.rolls, "to_burn")
        .call_method_with_name_lookup(t.component, "burn_rolls", |lookup| {
            manifest_args!(lookup.bucket("to_burn"))
        })
        .build();
    t.ledger
        .execute_manifest(via_component, vec![NonFungibleGlobalId::from_public_key(&t.pk)])
        .expect_commit_success();

    let (_minted, burned, _circulating) = stats(&mut t);
    assert_eq!(burned, dec!(1), "only the component's burn is counted");
}

/// The MAX_XRD boundary itself, on both sides of the line.
///
/// `a_large_purchase_succeeds` deliberately does NOT test this — it cannot, on a
/// 10,000 XRD account. The bound went untested through the widening from 10,000 to
/// 1,000,000 in #28, which is precisely when a bound is worth a test: the number
/// moved, and nothing checked that the guard moved with it.
///
/// Order matters. The over-the-limit attempt runs FIRST, while the account still
/// holds its full grant: a failed transaction rolls back every instruction in its
/// manifest, including the `withdraw_from_account`, and the fee is locked from the
/// faucet rather than this account — so nothing is deducted on failure and the
/// exactly-at-the-limit purchase that follows spends from an untouched balance.
#[test]
fn max_xrd_boundary_is_enforced() {
    // MAX_XRD in src/lib.rs. Deliberately a literal: this test exists to notice
    // when that constant moves, so importing it would defeat the purpose.
    let max_xrd = dec!(1_000_000);
    let mut t = setup_funded(max_xrd + dec!(10));

    buy(&mut t, max_xrd + dec!(1)).expect_commit_failure();
    buy(&mut t, max_xrd).expect_commit_success();
}
