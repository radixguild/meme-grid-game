use scrypto::prelude::*;

/// MemeGameVault v2 — ROLLS fungible token + XRD treasury for MEME GRID game
///
/// Players send XRD to `buy_rolls` and receive ROLLS at the vault's current
/// `xrd_per_roll` rate, with any XRD that does not buy a whole ROLL returned as
/// change. The game server watches `burn_rolls` receipts via the Gateway to credit
/// play balance. Treasury XRD is withdrawable by the owner for game operations.
///
/// ── Why there is a v2 ──────────────────────────────────────────────────────
///
/// v1 (`component_rdx1czh262wv…tj6lgxy`) has an IMMUTABLE owner role; its ~160 XRD treasury
/// can leave only through a proof of its one owner badge. The key to the account holding that
/// badge was missing from 2026-08-20 until it was found 2026-09-17; it is held now, so the XRD
/// is recoverable in principle; the badge and the XRD have not moved, and no recovery is planned
/// (decided 2026-10-11). Four design choices combined to make an ordinary key loss into a
/// near-permanent one, each corrected below:
///
///   1. `prepare_to_globalize(OwnerRole::Fixed(..))` surfaces on-chain as
///      `updater: "None"`. The owner rule could never be re-pointed at a badge we
///      still held — not even while the old badge was in hand. → now `Updatable`.
///   2. `admin` required the SAME badge as `owner`, so routine operations
///      (pausing) needed the badge that should have lived in cold storage.
///      → now a separate admin badge, and `withdraw_xrd` is OWNER-only.
///   3. The ROLLS resource was `OwnerRole::None` with every metadata field
///      `locked`, including `dapp_definitions` — branding frozen forever.
///      → now owned, with the fields that legitimately change left `updatable`.
///   4. A single owner badge went wherever the instantiating transaction dropped
///      it. → now two badges, so cold storage and a backup are separable, and the
///      deploy manifest is responsible for depositing them deliberately.
///
/// ⚠️ Read this before trusting `Updatable` to save you: an updatable owner role
/// lets the CURRENT owner re-point the rule at a new badge. It is a planned-rotation
/// mechanism, NOT loss recovery. If every copy of the owner badge is lost, an
/// `Updatable` component is just as stuck as a `Fixed` one. Loss is addressed by the
/// two-badge split below, and properly by holding badge #1 in an Access Controller
/// with a recovery role. See docs/VAULT-V1-LOST.md.

// ── Events ──────────────────────────────────────────

/// Note: v1 carried `buyer`/`burner` fields set to `Runtime::global_component().address()`
/// — the component's OWN address, not the caller's. They were useless for attribution and
/// actively misleading. The blueprint cannot see the paying account (a manifest-level call
/// arrives via the transaction processor, so `global_caller` is not the player either), so
/// the fields are gone rather than wrong. The server already attributes purchases from the
/// transaction's `fungible_balance_changes` and never read these fields.
#[derive(ScryptoSbor, ScryptoEvent)]
struct BuyRollsEvent {
    /// XRD actually taken into the treasury — `rolls_amount * xrd_per_roll`, NOT
    /// the amount tendered. The two differ whenever the payment is not a whole
    /// multiple of the price; the difference is `change_returned`.
    xrd_paid: Decimal,
    rolls_amount: Decimal,
    /// XRD handed back because it did not buy a whole ROLL. Recorded so a buyer
    /// can prove from the ledger that the vault kept only what it sold.
    change_returned: Decimal,
}

#[derive(ScryptoSbor, ScryptoEvent)]
struct BurnRollsEvent {
    rolls_amount: Decimal,
}

#[derive(ScryptoSbor, ScryptoEvent)]
struct PauseEvent {
    paused: bool,
}

/// A price change is publicly recorded rather than silent — players can see what
/// the rate was and what it became, without trusting the game's own UI.
#[derive(ScryptoSbor, ScryptoEvent)]
struct PriceChangedEvent {
    previous: Decimal,
    current: Decimal,
}

/// v1 emitted nothing when the treasury was drained, so an unexpected withdrawal
/// left no on-chain trace distinguishable from ordinary vault movement.
#[derive(ScryptoSbor, ScryptoEvent)]
struct TreasuryWithdrawEvent {
    amount: Decimal,
    remaining: Decimal,
}

// ── Constants ────────────────────────────────────────

/// Default rate at instantiate: 112 XRD = 1 ROLL. Owner-changeable afterwards via
/// `set_price`, so this is the launch default rather than a permanent decision.
///
/// This prices a ROLL at ~$0.10 and a whole board at ~$9.50, at $0.000895/XRD.
///
/// The ROLL is the unit that is priced; the board price is emergent (~90-95 paid
/// rolls, with BOARD_COST now 0). That follows the mechanic the game was built from:
/// a few hours of work earns a burst of ~4 rolls, so a board is ~24 work sessions —
/// a one-to-two month project companion, not a session. Buying instead of earning
/// therefore costs ~$0.40 a session.
///
/// Re-derive it, do not adjust it by feel: rate = target_usd_per_roll / xrd_usd.
/// Earlier values were 20 (~$1.75/board) and 35 (~$3/board); both were set against a
/// board-cost model that counted only the 5-ROLL start fee and an XRD price ~32x too
/// high. Price the roll.
///
/// (v1's doc comments claimed 1:100 while its constant was 1, and a draft of this
/// line said "1 XRD = 1 ROLL" directly above a constant of 20 — the same rot,
/// reintroduced. The rate appears in exactly one place: the constant below.)
const DEFAULT_XRD_PER_ROLL: i64 = 112;

/// Hard bounds on `xrd_per_roll`, enforced by `set_price`.
///
/// The price is owner-settable so the game can be repriced without a redeploy, but
/// "settable" must not mean "settable to anything". A zero or negative rate would
/// mint ROLLS for nothing. Bounds are checked in the blueprint, not in the client,
/// because the client is not the thing that has to be trusted.
///
/// ⚠️ These are the ONLY part of the pricing that a redeploy is needed to change, so
/// they are set as SANITY RAILS, not as business limits. The previous 1..10,000 was
/// the latter by accident: the floor of 1 XRD/ROLL puts a hard minimum of ~97 XRD on
/// a board, which at $0.10/XRD would be a $9.70 board that could not be made cheaper
/// without abandoning the component. A price band has to survive the token moving,
/// in both directions, for as long as this vault is expected to live.
///
/// Sized so the needed rate stays inside them across a wide range: with a board at
/// ~97 ROLLS, targeting anywhere from $0.50 to $10 a board, and XRD anywhere from
/// $0.0001 to $0.10, the required rate spans ~0.05 to ~1,030. The rails below leave
/// three orders of magnitude of headroom on each side of that.
const MIN_XRD_PER_ROLL: &str = "0.001";
const MAX_XRD_PER_ROLL: i64 = 1_000_000;

/// Dust guard only. The REAL minimum purchase is "enough to buy one whole ROLL",
/// enforced by the `rolls_amount > 0` assert in `buy_rolls`, and it moves with the
/// price automatically.
///
/// This was 1 XRD, which is fine at 35 XRD/ROLL and wrong at a low one: with the
/// price at 0.001 it would have forced a minimum purchase of 1,000 ROLLS. A fixed
/// XRD floor cannot sit above a variable XRD price without eventually colliding
/// with it, so it is kept below anything the price can be set to.
const MIN_XRD: &str = "0.000001";

/// Maximum single purchase. A fat-finger rail, not a business limit — 10,000 XRD was
/// ~$9 at $0.000895/XRD, so it capped a single transaction at under three boards.
const MAX_XRD: i64 = 1_000_000;

#[blueprint]
#[events(BuyRollsEvent, BurnRollsEvent, PauseEvent, TreasuryWithdrawEvent, PriceChangedEvent)]
mod meme_game_vault {

    enable_method_auth! {
        roles {
            admin => updatable_by: [OWNER];
        },
        methods {
            // Public — anyone can call
            buy_rolls          => PUBLIC;
            burn_rolls         => PUBLIC;
            get_price         => PUBLIC;
            get_treasury      => PUBLIC;
            get_stats         => PUBLIC;
            get_rolls_resource => PUBLIC;
            get_badges        => PUBLIC;
            is_paused         => PUBLIC;

            // Emergency stop — the warm admin badge is enough. A compromised admin
            // key can halt trading (annoying, reversible) but cannot move funds.
            set_paused        => restrict_to: [admin, OWNER];

            // Repricing is OWNER-only, deliberately NOT admin. It cannot take funds,
            // but it does set what players pay, so it belongs with the cold badge
            // rather than the warm one that only needs to stop trading in a hurry.
            set_price         => restrict_to: [OWNER];

            // Draining the treasury is OWNER-only, deliberately NOT admin. This is
            // the split v1 lacked: there, the badge needed for routine pausing was
            // also the badge that could take every XRD in the vault.
            withdraw_xrd      => restrict_to: [OWNER];
        }
    }

    struct MemeGameVault {
        /// XRD treasury vault
        xrd_vault: Vault,
        /// ROLLS fungible resource manager (component is sole minter)
        rolls_resource_manager: FungibleResourceManager,
        /// Owner badge resource — recorded so operators can verify custody on-chain
        /// without decoding the role assignment.
        owner_badge_address: ResourceAddress,
        /// Admin badge resource — same reason.
        admin_badge_address: ResourceAddress,
        /// Lifetime ROLLS minted
        total_minted: Decimal,
        /// Lifetime ROLLS burned. Only `burn_rolls` can move this — the burn role is
        /// restricted to the component, so it cannot be bypassed.
        total_burned: Decimal,
        /// Emergency pause
        paused: bool,
        /// XRD required per ROLL. Owner-settable via `set_price`.
        ///
        /// This is STATE, not a constant, and that is the whole point. v1 and the
        /// first draft of v2 both welded the rate into the WASM, which meant the
        /// game had one freely tunable acquisition rail (earning ROLLS, all
        /// server-side) and one frozen forever (buying them). Repricing then costs a
        /// redeploy, a new resource address, and orphaned balances — the exact
        /// failure that produced v2 in the first place.
        ///
        /// Note this changes the price of FUTURE purchases only. Nobody's existing
        /// ROLLS are revalued, because ROLLS are not a claim on the treasury: there
        /// is no redeem path, by design.
        xrd_per_roll: Decimal,
    }

    impl MemeGameVault {
        /// Instantiate the vault.
        ///
        /// Returns `(component, owner_badges, admin_badge)` where `owner_badges`
        /// holds TWO fungible badges and `admin_badge` holds one.
        ///
        /// ⚠️ The instantiating manifest MUST deposit these deliberately — v1's badge
        /// simply landed wherever the deploy transaction happened to put it, and that
        /// account's key was later lost. Intended split:
        ///   - owner badge #1 → cold custody (ideally an Access Controller)
        ///   - owner badge #2 → a separate backup account, different key material
        ///   - admin badge    → the warm operator account used for pausing
        /// Depositing both owner badges to one account reproduces v1's single point
        /// of failure and wastes the entire point of minting two.
        pub fn instantiate(dapp_def: GlobalAddress) -> (Global<MemeGameVault>, Bucket, Bucket) {
            // Reserve the component address up front so the ROLLS resource can name it
            // as minter.
            let (address_reservation, component_address) =
                Runtime::allocate_component_address(MemeGameVault::blueprint_id());

            // ── Owner badges (supply 2) ───────────────────────────────────────
            // `OwnerRole::None` is acceptable HERE, unlike on the component and the
            // ROLLS resource, and the difference is worth being explicit about: this
            // resource holds no funds, gates no role that anyone needs to change, and
            // its metadata is genuinely permanent. Nothing about it can become stuck
            // in a way that costs anything. Fixed supply and no mint role is the point
            // — a mintable owner badge would let a treasury-draining authority be
            // conjured at will.
            let owner_badges: Bucket = ResourceBuilder::new_fungible(OwnerRole::None)
                .divisibility(DIVISIBILITY_NONE)
                .metadata(metadata!(
                    init {
                        "name"        => "MEME GRID Owner", locked;
                        "symbol"      => "MGRID-OWNER", locked;
                        "description" => "Owner badge for MEME GRID Game Vault v2 — full authority, including treasury withdrawal. Two exist: keep them under separate key material.", locked;
                    }
                ))
                .mint_initial_supply(2)
                .into();
            let owner_badge_address = owner_badges.resource_address();
            let owner_rule = rule!(require(owner_badge_address));

            // ── Admin badge (supply 1) ────────────────────────────────────────
            // Warm key. Can pause; cannot withdraw.
            let admin_badge: Bucket = ResourceBuilder::new_fungible(OwnerRole::None)
                .divisibility(DIVISIBILITY_NONE)
                .metadata(metadata!(
                    init {
                        "name"        => "MEME GRID Admin", locked;
                        "symbol"      => "MGRID-ADMIN", locked;
                        "description" => "Operations badge for MEME GRID Game Vault v2 — can pause the vault, cannot move funds.", locked;
                    }
                ))
                .mint_initial_supply(1)
                .into();
            let admin_badge_address = admin_badge.resource_address();

            // ── MEME token ────────────────────────────────────────────────────
            // Owned and updatable, where v1 was `OwnerRole::None` with everything
            // `locked`. `name` and `symbol` stay locked — a token whose ticker can be
            // rewritten is a phishing surface, and those genuinely never change.
            // `description`, `icon_url` and `dapp_definitions` are `updatable`: the
            // first two are branding, and the third MUST be able to follow the dApp
            // definition account, which is exactly what v1 froze.
            let rolls_resource_manager = ResourceBuilder::new_fungible(OwnerRole::Updatable(
                owner_rule.clone(),
            ))
            .divisibility(DIVISIBILITY_MAXIMUM)
            .metadata(metadata!(
                init {
                    "name"        => "MEME GRID Rolls", locked;
                    "symbol"      => "ROLLS", locked;
                    "description" => "Game credits for MEME GRID, a dice game on Radix. One ROLL buys one roll of the die. No monetary value outside the game.", updatable;
                    "icon_url"    => Url::of("https://memegrid.radixguild.com/meme-icon.svg"), updatable;
                    "dapp_definitions" => vec![dapp_def], updatable;
                }
            ))
            .mint_roles(mint_roles!(
                minter         => rule!(require(global_caller(component_address)));
                // v1 pinned this to `deny_all`, which sounds conservative and is not:
                // it welds the token to ONE component forever, so any future vault
                // migration would have had to abandon the token and every player
                // balance with it. Owner-updatable lets a v3 component inherit this
                // exact ROLLS resource. The owner can already drain the treasury, so
                // this widens no trust boundary that was not already open.
                minter_updater => owner_rule.clone();
            ))
            .burn_roles(burn_roles!(
                // `global_caller`, not `allow_all`, and the difference is the player's
                // money. Under allow_all a holder could burn ROLLS straight off the
                // resource, which emits no `BurnRollsEvent` and never increments
                // `total_burned` — so the server credits nothing, the tokens are gone,
                // and `get_stats().circulating` overstates supply permanently with no
                // way to reconcile. Every legitimate burn already goes through
                // `burn_rolls`, so restricting to the component costs no real flow and
                // makes an unattributed burn impossible rather than merely unwise.
                // Mirrors the `minter` rule directly above, and meme-nfts' own roles.
                burner         => rule!(require(global_caller(component_address)));
                burner_updater => owner_rule.clone();
            ))
            .create_with_no_initial_supply()
            .into();

            let component = Self {
                xrd_vault: Vault::new(XRD),
                rolls_resource_manager,
                owner_badge_address,
                admin_badge_address,
                total_minted: Decimal::ZERO,
                total_burned: Decimal::ZERO,
                paused: false,
                xrd_per_roll: Decimal::from(DEFAULT_XRD_PER_ROLL),
            }
            .instantiate()
            // THE line. v1 used `OwnerRole::Fixed`, which the Gateway reports as
            // `updater: "None"` — unchangeable by anyone, forever. `Updatable` lets
            // the current owner re-point this rule at a fresh badge, so a planned key
            // rotation no longer requires abandoning the component.
            .prepare_to_globalize(OwnerRole::Updatable(owner_rule.clone()))
            .roles(roles!(
                admin => rule!(require(admin_badge_address));
            ))
            .metadata(metadata!(
                init {
                    "name"            => "MEME GRID Game Vault", locked;
                    "description"     => "XRD treasury and ROLLS minter for the MEME GRID dice game", updatable;
                    "dapp_definition" => dapp_def, updatable;
                }
            ))
            .with_address(address_reservation)
            .globalize();

            (component, owner_badges, admin_badge)
        }

        /// Buy ROLLS with XRD at the current `xrd_per_roll` rate.
        ///
        /// Returns `(rolls, change)`. ROLLS are whole units only, so a payment that
        /// is not an exact multiple of the price buys `floor(payment / price)` ROLLS
        /// and the remainder comes straight back — the vault keeps only what it sold.
        ///
        /// ⚠️ This method previously returned one bucket and put the WHOLE payment in
        /// the treasury, which silently kept up to `xrd_per_roll - 1` XRD (19 of every
        /// 20 at the launch default) on any non-multiple purchase. It went unnoticed
        /// because v1 priced ROLLS 1:1, where every payment divides exactly; raising
        /// the price to 20 is what made the rounding reachable. The shop's XRD field is
        /// free text and its `step` is advisory, so this was reachable from the
        /// product's own front door, not just from a hand-written manifest.
        ///
        /// Both buckets land on the worktop, so the existing manifests — which end in
        /// `deposit_batch ENTIRE_WORKTOP` — return the change to the buyer with no
        /// client change required.
        pub fn buy_rolls(&mut self, mut xrd_payment: Bucket) -> (Bucket, Bucket) {
            assert!(!self.paused, "Game vault is paused");
            assert!(xrd_payment.resource_address() == XRD, "Only XRD accepted");

            let xrd_amount = xrd_payment.amount();
            assert!(
                xrd_amount >= Decimal::try_from(MIN_XRD).unwrap(),
                "Minimum purchase is {} XRD",
                MIN_XRD
            );
            assert!(
                xrd_amount <= Decimal::from(MAX_XRD),
                "Maximum purchase is {} XRD",
                MAX_XRD
            );

            // Integer ROLLS only: the server-side balance is an integer and every
            // price in the game is a whole number, so minting a fraction would strand
            // dust that can never be spent.
            let rolls_amount = (xrd_amount / self.xrd_per_roll)
                .checked_floor()
                .expect("price calculation overflowed");
            assert!(
                rolls_amount > Decimal::ZERO,
                "Payment buys less than 1 ROLL at the current price"
            );

            // Charge for the ROLLS actually minted, not for whatever was tendered.
            // `cost <= xrd_amount` by construction (rolls_amount is the floor of the
            // quotient), so the take cannot underflow the payment.
            let cost = rolls_amount
                .checked_mul(self.xrd_per_roll)
                .expect("price calculation overflowed");
            self.xrd_vault.put(xrd_payment.take(cost));
            let change = xrd_payment;

            let rolls_bucket: Bucket = self.rolls_resource_manager.mint(rolls_amount).into();
            self.total_minted += rolls_amount;

            Runtime::emit_event(BuyRollsEvent {
                xrd_paid: cost,
                rolls_amount,
                change_returned: change.amount(),
            });

            (rolls_bucket, change)
        }

        /// Burn ROLLS (removes them from supply). The server watches these receipts
        /// to credit in-game actions.
        pub fn burn_rolls(&mut self, rolls_payment: Bucket) {
            assert!(!self.paused, "Game vault is paused");
            assert!(
                rolls_payment.resource_address() == self.rolls_resource_manager.address(),
                "Only ROLLS accepted"
            );

            let amount = rolls_payment.amount();
            assert!(amount > Decimal::ZERO, "Amount must be > 0");

            self.total_burned += amount;
            rolls_payment.burn();

            Runtime::emit_event(BurnRollsEvent {
                rolls_amount: amount,
            });
        }

        /// XRD required per ROLL.
        pub fn get_price(&self) -> Decimal {
            self.xrd_per_roll
        }

        /// Reprice future purchases. OWNER ONLY.
        ///
        /// Exists so the buy rail can be tuned the way the earn rail already can.
        /// Bounded, and emits an event, so a price change is a matter of public
        /// record rather than something players discover at the till.
        pub fn set_price(&mut self, xrd_per_roll: Decimal) {
            assert!(
                xrd_per_roll >= Decimal::try_from(MIN_XRD_PER_ROLL).unwrap()
                    && xrd_per_roll <= Decimal::from(MAX_XRD_PER_ROLL),
                "Price must be between {} and {} XRD per ROLL",
                MIN_XRD_PER_ROLL,
                MAX_XRD_PER_ROLL
            );

            let previous = self.xrd_per_roll;
            self.xrd_per_roll = xrd_per_roll;

            Runtime::emit_event(PriceChangedEvent {
                previous,
                current: xrd_per_roll,
            });
        }

        /// XRD treasury balance.
        pub fn get_treasury(&self) -> Decimal {
            self.xrd_vault.amount()
        }

        /// Lifetime stats: (total_minted, total_burned, circulating).
        pub fn get_stats(&self) -> (Decimal, Decimal, Decimal) {
            (
                self.total_minted,
                self.total_burned,
                self.total_minted - self.total_burned,
            )
        }

        /// The ROLLS resource address.
        pub fn get_rolls_resource(&self) -> ResourceAddress {
            self.rolls_resource_manager.address()
        }

        /// (owner_badge, admin_badge) resource addresses, so custody can be audited
        /// from a plain state read instead of decoding role assignments.
        pub fn get_badges(&self) -> (ResourceAddress, ResourceAddress) {
            (self.owner_badge_address, self.admin_badge_address)
        }

        /// Whether the vault is paused.
        pub fn is_paused(&self) -> bool {
            self.paused
        }

        // ── Restricted methods ───────────────────────────

        /// Emergency pause/unpause. Admin badge is sufficient.
        ///
        /// Note this halts `burn_rolls` as well as `buy_rolls`, so a pause suspends
        /// redemption of ROLLS players already hold, not just new sales. That is
        /// deliberate: the thing a pause exists to stop is the server's credit path
        /// being drained through burn receipts, which halting sales alone would not
        /// touch. It is a freeze, not a repudiation — unpausing restores every held
        /// ROLL, and nothing here can destroy or confiscate one.
        pub fn set_paused(&mut self, paused: bool) {
            self.paused = paused;
            Runtime::emit_event(PauseEvent { paused });
        }

        /// Withdraw XRD from the treasury. OWNER ONLY — see `enable_method_auth!`.
        pub fn withdraw_xrd(&mut self, amount: Decimal) -> Bucket {
            assert!(amount > Decimal::ZERO, "Amount must be > 0");
            assert!(
                amount <= self.xrd_vault.amount(),
                "Insufficient treasury balance"
            );

            let withdrawn = self.xrd_vault.take(amount);

            Runtime::emit_event(TreasuryWithdrawEvent {
                amount,
                remaining: self.xrd_vault.amount(),
            });

            withdrawn
        }
    }
}
