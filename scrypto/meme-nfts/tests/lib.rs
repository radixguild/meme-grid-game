//! Integration tests for the meme-grid-nfts blueprint (Scrypto 1.3, scrypto-test).
//!
//! Run on Linux: `cd scrypto && cargo test -p meme-nfts` (WASM build is Linux-only).
//!
//! These pin the pre-audit fixes (scrypto-audit-kit/trial-reports/meme-grid-nfts-*.json):
//!   - N-001: NFT ids are unique auto-increment INTEGERs, so the SAME achievement key
//!            can be minted to MANY players (the launch-blocker regression test).
//!   - auth : mint_nft_to is gated to the minter/owner badge.
//!   - N-006: mint_nft_to delivers via try_deposit_or_abort (the NFT lands in the account).
//!
//! Resource-address indexing below tracks the CREATION ORDER inside instantiate():
//! [0] owner badge, [1] minter badge, [2] NFT resource. If instantiate() is reordered,
//! update these indices.
//!
//! ── Recovery note (2026-08-13) — KNOWN ROT, NOT FIXED ───────────────────
//! Recovered via `git show f7eaf71:docs/drafts/nft-drops-vps-2026-07-24/scrypto-meme-nfts--tests--lib.rs`
//! from branch `vps-claude/wip-2026-08-04` (unrelated git history, never merged; do not merge or
//! diff it directly). Unlike the meme-token suite, this file does **not** line up cleanly with the
//! current `scrypto/meme-nfts/src/lib.rs` and was recovered verbatim (not hand-fixed) because there
//! is no way to compile-verify a fix from macOS. Two concrete problems found by inspection:
//!
//! 1. **Arity mismatch.** `mint_to()` below calls `mint_nft_to` with 6 manifest args (player, name,
//!    description, rarity, icon_url, game_key). The current blueprint's `mint_nft_to` takes 7:
//!    `(account, nft_id, name, description, rarity, icon_url, game_key)` — `nft_id` is missing
//!    entirely. This will not exercise the method correctly as written.
//! 2. **Premise mismatch.** This suite's N-001 regression test assumes NFT local ids are unique
//!    auto-increment INTEGERs assigned internally by the blueprint. The shipped design is the
//!    opposite: `mint_nft` takes a caller-supplied `nft_id: String` and calls
//!    `NonFungibleLocalId::string(nft_id)` directly (see the top-of-file comment in
//!    `scrypto/meme-nfts/src/lib.rs`) — uniqueness is the *caller's* job. Production's caller is
//!    `buildNftLocalId()` in `server/src/services/nft-minter.ts`, which composes
//!    `"<achievement_key>_<unlock_id>"`. Making the N-001 test ("same achievement key mints to many
//!    players") represent today's fix means passing distinct id strings per call (mirroring
//!    `buildNftLocalId`), not relying on internal auto-increment.
//! 3. **Bigger flag: wrong mint path.** Every test here calls the component's `mint_nft`/`mint_nft_to`
//!    directly. `server/src/services/nft-minter.ts:72-89` and `docs/PROJECT-STATE.md`'s Gotchas both
//!    document — verified against mainnet with `/transaction/preview` — that calling mint through the
//!    component aborts `Unauthorized` (the component holds no badge and the proof isn't in its call
//!    frame); production mints directly off the NFT resource address instead, bypassing
//!    `MemeGridNfts::mint_nft`/`mint_nft_to` entirely. Whether `LedgerSimulator` reproduces that same
//!    abort is unverified from macOS. If it does, an `Unauthorized` failure here would be *confirming
//!    the known gotcha*, not a new bug — and these tests would need to mint off the resource directly
//!    (mirroring `buildMintManifest`) to represent the real path.
//!
//! The `[dev-dependencies] scrypto-test` line in Cargo.toml was also missing (neither the original
//! 2026-08-04 commit nor current main ever added it) and has been added alongside this recovery so
//! `cargo test` can find the crate at all — that alone does not make this file pass. **Never
//! compiled**, and there is no CI job that runs `cargo test` for this workspace
//! (`.github/workflows/ci.yml` only covers the frontend and the Node server). Treat this file as a
//! recovered draft that needs both a Linux `cargo test` pass and the two fixes above, not a working
//! regression suite.

use scrypto::prelude::*;
use scrypto_test::prelude::*;

struct Test {
    /// Stands in for the server's unlock_id, so every mint gets a distinct local id.
    next_unlock_id: u64,
    ledger: DefaultLedgerSimulator,
    owner_pk: Secp256k1PublicKey,
    owner_account: ComponentAddress,
    component: ComponentAddress,
    #[allow(dead_code)]
    owner_badge: ResourceAddress,
    minter_badge: ResourceAddress,
    nft_resource: ResourceAddress,
}

/// Publish + instantiate the collection; the owner + minter badges land in owner_account.
fn setup() -> Test {
    let mut ledger = LedgerSimulatorBuilder::new().build();
    let (owner_pk, _sk, owner_account) = ledger.new_allocated_account();
    let package = ledger.compile_and_publish(this_package!());

    let manifest = ManifestBuilder::new()
        .lock_fee_from_faucet()
        .call_function(
            package,
            "MemeGridNfts",
            "instantiate",
            // dapp_def: GlobalAddress — the account address is a fine stand-in in tests.
            manifest_args!(GlobalAddress::from(owner_account)),
        )
        .try_deposit_entire_worktop_or_abort(owner_account, None)
        .build();
    let receipt =
        ledger.execute_manifest(manifest, vec![NonFungibleGlobalId::from_public_key(&owner_pk)]);
    let commit = receipt.expect_commit_success();

    let component = commit.new_component_addresses()[0];
    let resources = commit.new_resource_addresses();

    Test {
        next_unlock_id: 0,
        owner_pk,
        owner_account,
        component,
        owner_badge: resources[0],
        minter_badge: resources[1],
        nft_resource: resources[2],
        ledger,
    }
}

/// Mint one achievement NFT to `player`, authorised by the minter badge held in
/// `owner_account`. Returns the receipt so the caller can assert success/failure.
fn mint_to(t: &mut Test, player: ComponentAddress, game_key: &str) -> TransactionReceipt {
    // `nft_id` was missing entirely — the recovery note at the top of this file
    // called the arity gap by inspection on 2026-08-13, and CI run 32459934250
    // confirmed it by execution on 2026-08-21, the first time these tests ever
    // ran anywhere: "expected_field_count: 7, found: 6".
    //
    // Uniqueness is the CALLER's job (see the header of meme-nfts/src/lib.rs), so
    // this mirrors production's buildNftLocalId() in server/src/services/nft-minter.ts:
    // "<achievement_key>_<unlock_id>". A per-call counter stands in for unlock_id.
    let unlock_id = {
        t.next_unlock_id += 1;
        t.next_unlock_id
    };
    let manifest = ManifestBuilder::new()
        .lock_fee_from_faucet()
        .create_proof_from_account_of_amount(t.owner_account, t.minter_badge, dec!(1))
        .call_method(
            t.component,
            "mint_nft_to",
            manifest_args!(
                player,
                format!("{game_key}_{unlock_id}"),
                "Achievement".to_string(),
                "An earned achievement".to_string(),
                "common".to_string(),
                "https://memegrid.radixguild.com/nfts/x.svg".to_string(),
                game_key.to_string()
            ),
        )
        .build();
    t.ledger
        .execute_manifest(manifest, vec![NonFungibleGlobalId::from_public_key(&t.owner_pk)])
}

fn total_minted(t: &mut Test) -> u64 {
    let manifest = ManifestBuilder::new()
        .lock_fee_from_faucet()
        .call_method(t.component, "get_total_minted", manifest_args!())
        .build();
    let receipt = t
        .ledger
        .execute_manifest(manifest, vec![NonFungibleGlobalId::from_public_key(&t.owner_pk)]);
    receipt.expect_commit_success().output::<u64>(1)
}

#[test]
fn mint_to_delivers_nft_to_player() {
    let mut t = setup();
    let (_pk, _sk, player) = t.ledger.new_allocated_account();

    mint_to(&mut t, player, "first_grid").expect_commit_success();

    assert_eq!(
        t.ledger.get_component_balance(player, t.nft_resource),
        dec!(1),
        "player should hold exactly one achievement NFT"
    );
    assert_eq!(total_minted(&mut t), 1);
}

/// N-001 REGRESSION (the launch-blocker): the SAME achievement key must be mintable
/// to MANY players. Under the old design (local id == achievement key) the second
/// mint of "first_grid" panicked on a duplicate id. With auto-increment integer ids
/// both mints succeed and each player holds their own NFT.
#[test]
fn same_achievement_key_mints_to_many_players() {
    let mut t = setup();
    let (_pk_b, _sk_b, player_b) = t.ledger.new_allocated_account();
    let (_pk_c, _sk_c, player_c) = t.ledger.new_allocated_account();

    mint_to(&mut t, player_b, "first_grid").expect_commit_success();
    // Same game_key, different player — MUST NOT collide.
    mint_to(&mut t, player_c, "first_grid").expect_commit_success();

    assert_eq!(t.ledger.get_component_balance(player_b, t.nft_resource), dec!(1));
    assert_eq!(t.ledger.get_component_balance(player_c, t.nft_resource), dec!(1));
    assert_eq!(total_minted(&mut t), 2, "two distinct NFTs minted for the same achievement");
}

/// Auth: a caller without the minter (or owner) badge cannot mint.
#[test]
fn mint_requires_minter_or_owner_badge() {
    let mut t = setup();
    let (stranger_pk, _sk, stranger) = t.ledger.new_allocated_account();

    // No badge proof created — the auth zone is empty for the mint call.
    //
    // The arg list carries nft_id like every other call site. It did not, and this
    // test still "passed" — because the payload type-check rejected it before auth
    // was ever consulted. A negative test that passes for the wrong reason proves
    // nothing, and would keep passing if the auth rule were deleted entirely.
    let manifest = ManifestBuilder::new()
        .lock_fee_from_faucet()
        .call_method(
            t.component,
            "mint_nft_to",
            manifest_args!(
                stranger,
                "first_grid_1".to_string(),
                "Achievement".to_string(),
                "desc".to_string(),
                "common".to_string(),
                "https://memegrid.radixguild.com/nfts/x.svg".to_string(),
                "first_grid".to_string()
            ),
        )
        .build();
    let receipt = t
        .ledger
        .execute_manifest(manifest, vec![NonFungibleGlobalId::from_public_key(&stranger_pk)]);

    receipt.expect_commit_failure();
}
