use scrypto::prelude::*;

/// MEME GRID NFT Collection — achievement NFTs minted by the game server
///
/// Game server holds the minter badge and mints NFTs directly to player accounts
/// when they unlock achievements.
///
/// ⚠️ ⚠️ THIS SOURCE IS FIXED; THE LIVE COLLECTION IS **NOT** REDEPLOYED. ⚠️ ⚠️
///
/// The live component (`component_rdx1cq9z0p42ndk4ckvpha3tu3g7h2fr4k373htcmfl4d6zvgjl8s028wv`)
/// carries the same `OwnerRole::Fixed` defect that stranded the v1 MEME vault behind an
/// immutable owner rule — the Gateway reports `updater: "None"` on its owner role too. The
/// difference is that its owner role is a single badge (`resource_rdx1thsd3ygg…079vejyew`), so
/// whoever holds that badge can present it and control the collection. The operator supplies
/// and holds the owner account; this source does not name it.
///
/// **Do not redeploy this collection to pick up these fixes.** Every achievement NFT
/// already minted lives in the OLD resource; a new component means a new resource, and
/// every player's NFTs would be orphaned. The fixes below apply to any FUTURE
/// collection. Redeploying is only justified alongside a deliberate holder migration.
///
/// The residual risk is unchanged and must be managed by custody, not by code: if that
/// one owner badge is ever lost, this collection becomes exactly as stuck as the v1
/// vault — minting would continue (the server holds the minter badge) but the minter
/// could never be revoked. Keep it cold. See docs/VAULT-V1-LOST.md.
///
/// `nft_id` is the on-chain NonFungibleLocalId and must be UNIQUE per NFT — it
/// is NOT the achievement key. Every player unlocks "first_grid", so keying the
/// id on the achievement would let one player take that id forever and abort
/// everyone else's mint as a duplicate. The server passes
/// "<achievement_key>_<unlock_id>" (see buildNftLocalId in nft-minter.ts).
/// Which design an NFT represents is carried by the separate `game_key` field.

// ── NFT Data ────────────────────────────────────────────

#[derive(ScryptoSbor, NonFungibleData)]
pub struct MemeGridNft {
    /// Display name (e.g. "First Grid", "Meme Lord")
    pub name: String,
    /// Achievement description
    pub description: String,
    /// Rarity tier: common, uncommon, rare, epic, legendary, mythic
    pub rarity: String,
    /// HTTPS URL to NFT icon (displayed in Radix wallet)
    pub icon_url: Url,
    /// Game achievement key (e.g. "first_grid") — links to server-side catalog
    pub game_key: String,
}

// ── Events ──────────────────────────────────────────────

#[derive(ScryptoSbor, ScryptoEvent)]
struct MintNftEvent {
    nft_id: NonFungibleLocalId,
    /// The account the NFT was deposited into, when the blueprint knows it.
    ///
    /// `None` for `mint_nft`, which hands a bucket back to the caller and genuinely
    /// cannot see where it ends up. `Some(account)` for `mint_nft_to`, which does.
    ///
    /// This was previously a bare `ComponentAddress` set to
    /// `Runtime::global_component().address()` — the component's OWN address, on every
    /// mint, including `mint_nft_to` calls that had the real account in hand. Every
    /// event the live collection has ever emitted names the minter as the recipient,
    /// so the field is unusable for attribution rather than merely imprecise.
    recipient: Option<ComponentAddress>,
    game_key: String,
    rarity: String,
}

// ── Blueprint ───────────────────────────────────────────

#[blueprint]
#[events(MintNftEvent)]
mod meme_grid_nfts {

    enable_method_auth! {
        roles {
            minter => updatable_by: [OWNER];
        },
        methods {
            // Public reads
            get_nft_resource  => PUBLIC;
            get_total_minted  => PUBLIC;
            // Minter-only (game server)
            mint_nft          => restrict_to: [minter, OWNER];
            mint_nft_to       => restrict_to: [minter, OWNER];
        }
    }

    struct MemeGridNfts {
        /// NFT resource manager
        nft_resource_manager: NonFungibleResourceManager,
        /// Minter badge address (for reference)
        minter_badge_address: ResourceAddress,
        /// Total NFTs minted
        total_minted: u64,
    }

    impl MemeGridNfts {
        /// Instantiate the NFT collection.
        /// Returns: (component, owner_badge, minter_badge)
        ///
        /// - owner_badge: full admin control (keep in cold wallet)
        /// - minter_badge: game server uses this to mint NFTs (can be revoked)
        pub fn instantiate(
            dapp_def: GlobalAddress,
        ) -> (Global<MemeGridNfts>, Bucket, Bucket) {
            // Owner badge — full admin, keep safe
            let owner_badge: Bucket = ResourceBuilder::new_fungible(OwnerRole::None)
                .divisibility(DIVISIBILITY_NONE)
                .metadata(metadata!(
                    init {
                        "name"        => "MEME GRID NFT Owner", locked;
                        "symbol"      => "MGRID-NFT-OWNER", locked;
                        "description" => "Owner badge for MEME GRID NFT Collection — full authority. Two exist: keep them under separate key material.", locked;
                    }
                ))
                .mint_initial_supply(2)
                .into();
            let owner_badge_address = owner_badge.resource_address();
            let owner_rule = rule!(require(owner_badge_address));

            // Minter badge — game server holds this
            let minter_badge: Bucket = ResourceBuilder::new_fungible(OwnerRole::None)
                .divisibility(DIVISIBILITY_NONE)
                .metadata(metadata!(
                    init {
                        "name"        => "MEME GRID NFT Minter", locked;
                        "symbol"      => "MGRID-NFT-MINTER", locked;
                        "description" => "Minter badge for MEME GRID game server", locked;
                    }
                ))
                .mint_initial_supply(1)
                .into();

            let minter_badge_address = minter_badge.resource_address();

            // Reserve component address for self-referencing auth
            // Now actually used: the NFT resource names this address as its only
            // minter (see mint_roles below). It was `_component_address` — reserved
            // and never referenced — which is precisely why the resource fell back to
            // gating on badge presence and the component could not mint through its
            // own methods.
            let (address_reservation, component_address) =
                Runtime::allocate_component_address(MemeGridNfts::blueprint_id());

            // NFT resource — minter badge or owner can mint, no one can burn
            // v1 shipped this as `OwnerRole::None` with every metadata field `locked`,
            // which froze the collection's branding and its `dapp_definitions` link
            // permanently. Owned and selectively updatable instead.
            let nft_resource_manager = ResourceBuilder::new_string_non_fungible::<MemeGridNft>(
                OwnerRole::Updatable(owner_rule.clone()),
            )
            .metadata(metadata!(
                init {
                    "name"             => "MEME GRID Achievements", locked;
                    "symbol"           => "MGRID-NFT", locked;
                    "description"      => "Achievement NFTs from MEME GRID dice game on Radix", updatable;
                    "icon_url"         => Url::of("https://memegrid.radixguild.com/nfts/collection.svg"), updatable;
                    "dapp_definitions" => vec![dapp_def], updatable;
                }
            ))
            // The resource trusts the COMPONENT, not a badge — matching meme-token
            // (meme-token/src/lib.rs) and reversing what this collection shipped with.
            //
            // v1 gated this on badge presence: `require(minter_badge_address) ||
            // require(owner_badge_address)`. That has two consequences, and the second
            // is the serious one:
            //
            //   1. The component cannot mint through its OWN methods. A proof created
            //      in the transaction does not propagate into the component's call
            //      frame, so mint_nft/mint_nft_to abort Unauthorized. That is why
            //      server/src/services/nft-minter.ts mints straight off the resource
            //      with MINT_NON_FUNGIBLE and documents the reason at its buildMintManifest.
            //      CI run 32461648943 proved it by execution rather than by reading:
            //      AuthError(Unauthorized(RoleKey "minter", NonFungibleResourceManager::mint)).
            //   2. Because minting bypasses the component, every rule the component
            //      exists to enforce is bypassed with it. Any holder of the raw minter
            //      badge can mint arbitrary NFT data with zero on-chain validation, and
            //      no invariant (caps, uniqueness, provenance) can ever be added without
            //      redeploying to a new resource address.
            //
            // With global_caller the only minter, mints MUST go through mint_nft/
            // mint_nft_to, which are already gated on the minter badge by
            // enable_method_auth! above. Same badge, same operator, but the component's
            // rules become unskippable and future invariants become addable.
            //
            // ⚠️ A future collection deployed from this source needs nft-minter.ts changed
            // to CALL the component instead of minting off the resource. The live
            // collection is unaffected — it is explicitly never redeployed (see the
            // header) — so today's minting path keeps working untouched.
            //
            // minter_updater stays with the owner, so the rule can be re-pointed if a
            // recovery path is ever needed, rather than a standing bypass existing.
            .mint_roles(mint_roles!(
                minter         => rule!(require(global_caller(component_address)));
                minter_updater => owner_rule.clone();
            ))
            .burn_roles(burn_roles!(
                burner         => rule!(deny_all);
                burner_updater => owner_rule.clone();
            ))
            .non_fungible_data_update_roles(non_fungible_data_update_roles!(
                non_fungible_data_updater         => rule!(deny_all);
                non_fungible_data_updater_updater => owner_rule.clone();
            ))
            .create_with_no_initial_supply();

            let component = Self {
                nft_resource_manager,
                minter_badge_address,
                total_minted: 0,
            }
            .instantiate()
            // `Fixed` surfaces on-chain as `updater: "None"` — the owner rule can never
            // be re-pointed, by anyone, ever. That single word is what turned an ordinary
            // key loss into a permanent one for the v1 MEME vault. `Updatable` lets the
            // current owner rotate to a fresh badge while the old one is still in hand.
            // It is NOT loss recovery: lose every copy and this is just as stuck.
            .prepare_to_globalize(OwnerRole::Updatable(owner_rule.clone()))
            .roles(roles!(
                minter => rule!(require(minter_badge_address));
            ))
            .metadata(metadata!(
                init {
                    "name"            => "MEME GRID NFT Minter", locked;
                    "description"     => "Achievement NFT minting component for MEME GRID game", updatable;
                    "dapp_definition" => dapp_def, updatable;
                }
            ))
            .with_address(address_reservation)
            .globalize();

            (component, owner_badge, minter_badge)
        }

        /// Mint an NFT and return it for the caller to deposit.
        ///
        /// Emits `recipient: None` — this path hands back a bucket and cannot know
        /// where it lands. Use `mint_nft_to` when the destination is known, so the
        /// event carries it.
        pub fn mint_nft(
            &mut self,
            nft_id: String,
            name: String,
            description: String,
            rarity: String,
            icon_url: String,
            game_key: String,
        ) -> Bucket {
            self.mint_internal(nft_id, name, description, rarity, icon_url, game_key, None)
        }

        /// Shared mint path. `recipient` is recorded in the event verbatim.
        fn mint_internal(
            &mut self,
            nft_id: String,
            name: String,
            description: String,
            rarity: String,
            icon_url: String,
            game_key: String,
            recipient: Option<ComponentAddress>,
        ) -> Bucket {
            let local_id = NonFungibleLocalId::string(nft_id.clone())
                .expect(&format!(
                    "Invalid NFT ID '{}': must be 1-64 alphanumeric/underscore characters",
                    &nft_id[..nft_id.len().min(64)]
                ));

            let nft_data = MemeGridNft {
                name,
                description,
                rarity: rarity.clone(),
                icon_url: Url::of(icon_url),
                game_key: game_key.clone(),
            };

            let nft_bucket = self.nft_resource_manager.mint_non_fungible(
                &local_id,
                nft_data,
            );

            self.total_minted += 1;

            Runtime::emit_event(MintNftEvent {
                nft_id: local_id,
                recipient,
                game_key,
                rarity,
            });

            nft_bucket.into()
        }

        /// Mint an NFT and deposit directly to a player account.
        /// Convenience method — combines mint + deposit in one call.
        pub fn mint_nft_to(
            &mut self,
            account: ComponentAddress,
            nft_id: String,
            name: String,
            description: String,
            rarity: String,
            icon_url: String,
            game_key: String,
        ) -> () {
            let nft_bucket = self.mint_internal(
                nft_id, name, description, rarity, icon_url, game_key, Some(account),
            );

            // Use global caller to deposit — requires account to accept deposits
            let mut account_component: Global<Account> = Global::from(account);
            account_component.try_deposit_or_abort(nft_bucket, None);
        }

        /// Get the NFT resource address
        pub fn get_nft_resource(&self) -> ResourceAddress {
            self.nft_resource_manager.address()
        }

        /// Get total NFTs minted
        pub fn get_total_minted(&self) -> u64 {
            self.total_minted
        }
    }
}
