# MEME GRID v2 prize vault — design

Status: **DESIGN ONLY, 2026-11-07 (AEDT). No code, no deploy, nothing on any ledger or box.** Tier A
docs PR. If this page disagrees with [`STATE.md`](../../STATE.md), `STATE.md` wins.

Scope: ruling 5 of the operator's 7 Nov 2026 sitting prep: the prize vault is a **separate design**,
"a vault that can hold prize NFTs/tokens but can never hold badges", with
`NFT_PRIZE_RESOURCE_ALLOWLIST` naming the v2 ROLLS resource and the achievement collection. House
rule for new builds: research, design, plan, and only then code.

Claims rule: every statement is backed by a repo file, a cited page, or is marked **INFERRED**,
**SPECULATIVE**, **ESTIMATE** or **UNKNOWN**. Where this page says "never", it names the mechanism
and its limit (§3.1, §3.8).

## 0. Summary

- Build a separate `PrizeVault` component whose every bucket-accepting method asserts the resource
  is acceptable under an on-ledger rule: allowlisted (our two resources) or an open-gift
  non-fungible not on a `forbidden` list (owner ruling R6, 7 Nov). A component has no account-style
  receive path (INFERRED, §2.2), so nothing else can enter.
- "Cannot hold badges" cannot be enforced by classification: no on-ledger badge flag was found
  (§2.1). The enforceable claim is: **no fungible resource other than allowlisted ones, and no
  resource on the `forbidden` list.** Every custody badge in this repo is fungible (owner, admin,
  collection owner, collection minter), so refusing unlisted fungibles keeps them out structurally;
  `forbidden` is the backstop. Third-party NFTs are accepted by owner ruling, so the vault can hold
  arbitrary third-party non-fungibles: that is a stated residual, not a bug (§3.6).
- Reuse of an account as the "vault" was considered and rejected: the owner can bypass deposit rules
  (§2.3).
- Awards by the hot server key are **ruled out for v1** (R5, 7 Nov): awards are signed by the admin or an owner badge.
- The owner ruled R1 to R9 on 7 Nov; two new yes/no rulings (R10, R11) follow from R6 (§5). Estimated build: roughly 26 to 36 lane-hours,
  **ESTIMATE** (§4).

## 1. What the v2 deploy creates, and where each badge lives

Source: `server/src/services/deploy-meme-token.ts` and `scrypto/meme-token/src/lib.rs` on `main`
at the time of writing. Nothing below is deployed; `STATE.md` says the v2 vault "is not deployed".

### 1.1 Resources and entities

| # | Entity | Created by | Supply / shape | Source |
|---|---|---|---|---|
| 1 | Package `MemeGameVault` v2 | deploy step 1 (`publishPackage`) | WASM + RPD built on Linux | `deploy-meme-token.ts` (main, `publishPackage`) |
| 2 | Component `MemeGameVault` | step 2 (`MemeGameVault::instantiate(dapp_def)`) | XRD vault + ROLLS minter; owner role `Updatable(require(owner badge))` | `lib.rs` `prepare_to_globalize(OwnerRole::Updatable(..))` |
| 3 | Owner badge resource (`MGRID-OWNER`) | `instantiate` | fungible, divisibility none, **supply 2**, no mint role, `OwnerRole::None` | `lib.rs` `mint_initial_supply(2)` |
| 4 | Admin badge resource (`MGRID-ADMIN`) | `instantiate` | fungible, divisibility none, **supply 1**, `OwnerRole::None` | `lib.rs` `mint_initial_supply(1)` |
| 5 | ROLLS token resource (`memeResource` in `deploy-state.json`) | `instantiate` | fungible, divisibility max, mint/burn only by `global_caller(component)`, owner role `Updatable(owner rule)` | `lib.rs` `ResourceBuilder::new_fungible(OwnerRole::Updatable(..))` |

**Naming caveat.** The operator's sitting sheet and the deploy script's log lines call resource 5
"the new MEME token". The blueprint names it `MEME GRID Rolls`, symbol `ROLLS`, and stores its
address under `memeResource`. They are the same resource. This document says "ROLLS (`memeResource`)"
and uses "MEME" only when quoting. Whether the public copy should rename it is a separate question
and is not decided here.

### 1.2 Method auth on the v2 vault component

From `enable_method_auth!` in `lib.rs`:

| Method | Auth |
|---|---|
| `buy_rolls`, `burn_rolls`, getters | PUBLIC |
| `set_paused` | `admin` or OWNER |
| `set_price`, `withdraw_xrd` | OWNER only |
| `admin` role itself | updatable by OWNER |

### 1.3 Where each badge goes (deploy step 3)

`distributeBadges` withdraws all three from the deployer and sends them in **one transaction**,
each with `try_deposit_or_abort`, then `verifyCustody` reads the ledger and requires the deployer to
hold none. `resolveCustody` on mainnet refuses to run unless three env names are set, are valid
account addresses, are pairwise distinct, and none is the deploying account.

**Fallback caveat.** If the operator's sheet falls back to one account serving as both cold and backup
(its branch for when the second seed cannot be opened), that configuration **fails** `resolveCustody`'s
three-distinct-accounts rule and the deploy refuses to run. In that branch the owner must name a
third account. This is an open item on the sheet, not something this design can resolve.

| Badge | Env name | Quantity | Role in the operator's private mapping (ruled 7 Nov 2026) |
|---|---|---|---|
| Owner badge #1 | `VAULT_OWNER_COLD_ACCOUNT` | 1 | cold custody |
| Owner badge #2 | `VAULT_OWNER_BACKUP_ACCOUNT` | 1 | backup, different key material |
| Admin badge | `VAULT_ADMIN_ACCOUNT` | 1 | warm operations |

This repository deliberately names no custody account (`PROVENANCE.md`), so this document does not
either. The three accounts and their registry rows live in the operator's private sitting sheet.
Everything below refers to them by role: **cold**, **backup**, **admin**.

### 1.4 Other custody facts the prize vault depends on (all from this repo)

- **Achievement NFT collection** (`scrypto/meme-nfts`, address in `src/lib/constants.ts` as
  `NFT_RESOURCE`): its owner badge sits in a cold operator account and its **minter badge sits in
  the server's hot signing account** (`PROVENANCE.md`). That hot account is also the published
  `NFT_TREASURY_ACCOUNT` (`STATE.md`, Disclosures).
- **v1 vault owner/admin badge** (`resource_rdx1t42g9r…a0qtugls`, `docs/VAULT-V1-LOST.md`): retired,
  but it is a live custody badge for a component that still accepts deposits.
- **Prize pool today** is not a vault. `GET /api/vault/nfts` lists what the hot account holds,
  filtered by `NFT_PRIZE_RESOURCE_ALLOWLIST` (`server/src/routes/vault.ts`, `prize-allowlist.ts`).
  The filter is **display-side only**: it does not stop anything being sent to that account, and
  `assertAllowedPrizeResources` is "Not called by any route yet" (its own doc comment). No on-chain
  award path exists; the send is a `TODO` (`STATE.md`).

### 1.5 Why this needs a design and not an env var

An account accepts whatever its deposit rule lets in (see §2). The current treasury account is the
hot signer, so a custody badge (for example the NFT collection's minter badge, which already lives
there) shares an address with the "prize pool". The allowlist hides it from the public list; it
does not make the account unable to hold it, and it does not stop a transaction from sending it
out. The v1 lesson in `docs/VAULT-V1-LOST.md` is that custody has to be mapped before anything is
funded; this document applies that to prizes.
## 2. Research: what Radix can and cannot enforce

Read 2026-11-07. Where a page did not say a thing outright it is marked **INFERRED**; where nothing
was found it is marked **NOT FOUND**. Nothing here was run against a ledger.

### 2.1 Vaults, and whether "badge" exists as a property

- A vault is created for one resource: `Vault::new(ResourceAddress)` makes an empty vault "that will
  be used to stored resources of the specified `ResourceAddress`"; an account holds "a vault for each
  resource type it owns", and the account example keeps `vaults: KeyValueStore<ResourceAddress, Vault>`
  and creates a vault when a new resource arrives. Source:
  <https://docs.radixdlt.com/docs/buckets-and-vaults>. "One resource per vault" is **INFERRED** from
  those lines.
- A `put` of a different resource aborting: the docs page only says `.put(bucket)` deposits a bucket.
  A third-party lesson says a mismatch raises an error
  (<https://scrypto101.pages.dev/lesson/651a82b9a9a7cd79c803323b>). Error text **NOT FOUND**. The
  design does not rely on it: the component checks `bucket.resource_address()` itself first.
- Comparing a bucket's resource address with an allowlist is **INFERRED** from the account pattern
  above. No official allowlist pattern was found (**NOT FOUND**).
- **No on-ledger "this resource is a badge" flag was found** (**NOT FOUND**). On that page badges
  appear only in authorization (e.g. `.authorize(...)` puts the badges in a vault on the AuthZone).
  That any resource can be named in a role rule is consistent with this but **INFERRED**. This is
  why the design cannot classify; it can only allowlist.

### 2.2 Can anything be pushed into a component without calling a method?

- The docs say an account receives tokens "through a call to one of its deposit methods"
  (<https://docs.radixdlt.com/docs/buckets-and-vaults>). Nothing found says a component has a
  receive path like that. "A component receives buckets only through method arguments or method
  returns" is **INFERRED** from the bucket model (buckets must be empty or stored by transaction
  end). **UNVERIFIED**: no official statement was found. The ledger test list (§4) includes a test
  that tries to place a foreign resource in the component by every manifest route available, so this
  is checked, not assumed.

### 2.3 Account deposit rules (and why an account is not the vault)

All from <https://docs.radixdlt.com/docs/account> (the page's method headings are misaligned; verify
against the blueprint source before relying on any single line):

- Modes when a resource has no preference: **Accept**, **Reject**, **Allow Existing** (permits a
  resource the account "has ever held before", or XRD).
- Per-resource preferences `Allowed` / `Disallowed` are checked first; even XRD can be disallowed.
- **Authorized depositors** (a badge) bypass preferences and mode.
- `try_deposit_or_abort`, `try_deposit_or_refund` and the batch variants respect the rules.
- **`deposit` and `deposit_batch` "can only be called by the account owner" and do not do the
  deposit-mode checks.**

Consequence: an account set to Reject-by-default with an allowlist of `Allowed` preferences would
stop third parties using `try_deposit*`, but the account's own signer can still `deposit` anything,
and an authorized depositor can too. It is a policy, not a structural guarantee, and the hot-signer
account is exactly the signer that already holds a minter badge. **Option rejected.** (The same
mode/preference settings are still worth setting on the owner accounts that hold badges; that is an
operator step, not part of this design.)

### 2.4 Resource-level and method-level controls

- Resource roles, defaults as stated at <https://docs.radixdlt.com/docs/resource-behaviors>:
  `depositor => allow_all`, `depositor_updater => deny_all`, `withdrawer => allow_all`,
  `freezer`/`recaller => deny_all`. A resource's `depositor` role is set by that resource's creator,
  so it cannot be used to make a third party's resource refuse to enter our vault. Whether a
  restrictive `depositor` would also block account vaults is **INFERRED, not confirmed**. For our
  own v2 badges it is a possible hardening and **rejected here as out of scope**: the v2 badge
  resources are fixed by the v2 vault deploy, and a depositor restriction could also block placing
  them in the custody accounts.
- Method auth: `enable_method_auth!`, `restrict_to`, `PUBLIC`, `SELF`, a mandatory OWNER role, and
  `updatable_by: []` for an effectively immutable role
  (<https://docs.radixdlt.com/docs/structure-roles-and-methods>). `OwnerRole::None / Fixed /
  Updatable` meanings from <https://docs.radixdlt.com/docs/productionize-your-code> (seen as a search
  snippet only). `global_caller` is in the engine source
  (<https://docs.rs/radix-engine-interface/1.2.0/src/radix_engine_interface/blueprints/resource/proof_rule.rs.html>);
  no docs page was found (**NOT FOUND**). This repo already uses it in both blueprints.
- How the Gateway renders an owner rule as `updater: "None"`: **NOT FOUND** in the spec read. The
  repo itself reports it (`docs/VAULT-V1-LOST.md`, read from the Gateway on 2026-08-21).

### 2.5 What the Gateway can read after deploy

Source: <https://docs.radixdlt.com/api-reference/gateway-api-specs> (the Redoc site was not
readable by the fetch tool). Paths listed there:

- `/state/entity/details` with `aggregation_level` `Global` or `Vault` (each vault separately), and
  optional `at_ledger_state` to pin a historic state.
- `/state/entity/page/fungibles`, `/fungible-vaults`, `/non-fungibles`, `/non-fungible-vaults`,
  `/non-fungible-vault/ids`.
- `/state/entity/page/metadata`, `/state/entity/page/schemas`.
- `/state/package/page/blueprints` and `/state/package/page/codes` (returns `code_hash_hex`,
  `vm_type`, `code_hex` per item).
- `/state/key-value-store/keys` and `/data` (a `KeyValueStore` allowlist is readable this way:
  **INFERRED**).
- `/stream/transactions` and `/extensions/resource-holders/page`.

Not confirmed from the spec read: the exact shape of `role_assignments` and component state fields,
and the event filters on `/stream/transactions`. The repo already reads state fields and holdings
through `/state/entity/details` (`server/src/services/gateway.ts`,
`deploy-meme-token.ts` `resolveEntities`), so those two are known to work for components here, but
their precise response shape for the new blueprint is **UNKNOWN** until a stokenet run.

### 2.6 Verifying that on-ledger code is the published source

- `scrypto-builder` is documented as "a tool for compiling Scrypto projects in a deterministic way"
  that lets third parties verify package WASM and RPD "are indeed compiled from a specific source
  code" (<https://docs.radixdlt.com/docs/scrypto-builder>). Latest tag seen: v1.3.1
  (<https://hub.docker.com/r/radixdlt/scrypto-builder/tags>).
- **The hash function behind `code_hash_hex` is UNVERIFIED.** It may be Blake2b-256 rather than
  SHA-256 (not confirmed from a cited source). So this design does **not** claim `code_hash_hex`
  equals the SHA-256 of the WASM. Comparing hashes of the same function, or comparing `code_hex`
  bytes read from `/state/package/page/codes` with the CI artifact bytes, is a **stokenet check**
  (§4 steps 6 and 7), not an established method. The page does not mention hashes. A community repo reports that a deployed WASM can differ from a
  local build (<https://github.com/just-lock/locker>). No official source-verification service was
  found (**NOT FOUND**).
- This repo's CI already builds the WASM and RPD on Linux and uploads them as run artifacts
  (`CONTRIBUTING.md`, "What CI checks"). Whether that CI build is byte-reproducible against a
  `scrypto-builder` build is **UNKNOWN** and is a step in §4.

### 2.7 Options considered

| Option | Enforces "only allowlisted" | Verdict |
|---|---|---|
| Keep the hot signer account as the pool, rely on the env allowlist | No (display filter) | Rejected: today's state, and its disclosure in `STATE.md` |
| Dedicated account with Reject + `Allowed` list | Third parties only; owner `deposit` bypasses | Rejected (§2.3) |
| Resource-side `depositor` restrictions on our badges | Unclear, may block custody placement | Rejected (§2.4) |
| **Separate component, allowlist asserted in every receiving method** | Yes, in code | **Chosen** |

## 3. Design

### 3.1 Decision summary (recommendations, each pending an owner ruling in §5)

1. **A separate package and component, `PrizeVault`.** Not a new method on `MemeGameVault`: that
   blueprint holds the XRD treasury and mints ROLLS, and prize logic would widen the surface of a
   component that custodies money. Separate component = separate custody story, separate pause.
2. **Enforcement lives in the component, on the ledger.** The acceptance rule (§3.2) is component
   code and state checked inside every method that accepts a bucket. A server env var cannot make a ledger entity refuse
   anything.
3. **`NFT_PRIZE_RESOURCE_ALLOWLIST` stays, but demoted to a server-side mirror**: a display filter
   and a boot/CI check that it is a subset of the on-ledger allowlist. It is never the enforcement.
4. **Allowlist is append-only by OWNER, plus owner `disallow`** (stops new deposits and awards of
   that resource; never traps what is already inside, see `withdraw_prize`).
5. **Two acceptance tiers (R6, ruled 7 Nov).** Tier 1, the allowlist: the v2 ROLLS resource and the
   achievement NFT collection (ruling 5 of the sitting sheet), any kind. Tier 2, open gifts: **any
   non-fungible resource not on `forbidden`**, so community members can gift third-party NFTs. No
   third-party fungible is accepted unless OWNER adds it to the allowlist.
6. **The component never calls itself "badge-proof" on classification.** No on-ledger property marks a
   resource as a badge (§2.1). The claim is "holds no unlisted fungible and nothing on `forbidden`".
   That is weaker than "cannot hold badges" in the abstract and it is the claim the code can back.
   A non-fungible *custody* badge would pass the tier-2 rule unless it is on `forbidden`; none exists
   in this repo today (all four are `new_fungible`), and any future one must be added to `forbidden`
   in the same change that creates it.

**Does R6 weaken the claim?** Yes, and the doc now says so: the claim was "holds only allowlisted
resources" and is now "no unlisted fungible, nothing on `forbidden`", so unlisted non-fungibles can
be held. A third-party resource that is itself a badge is handled as follows: a fungible one is
rejected by the allowlist rule; a non-fungible one is accepted, held, and returned by OWNER
`withdraw_prize` on request (§3.6).

### 3.2 Component surface (proposed; nothing is implemented)

State (names are proposals):

| Field | Type | Notes |
|---|---|---|
| `allowed` | `IndexSet<ResourceAddress>` | **chosen**: a handful of entries, stored in component state so one entity read returns it. A `KeyValueStore` is not used, so no key-value-store read is needed |
| `vaults` | `KeyValueStore<ResourceAddress, Vault>` | one vault per allowed resource, created on first deposit |
| `forbidden` | `IndexSet<ResourceAddress>` | the custody badges known at instantiate (§3.4). Backstop, not the claim |
| `paused` | `bool` | |
| `owner_badge_address`, `admin_badge_address` | `ResourceAddress` | recorded for read-back, mirroring `get_badges` on `MemeGameVault` |

Methods:

| Method | Auth (proposed) | Behaviour |
|---|---|---|
| `deposit_prize(bucket)` | PUBLIC (R4) | assert not paused; assert resource not in `forbidden` and (in `allowed` **or** non-fungible: checked from the resource address type, **INFERRED** feasible, confirmed in build step 1); `put` into that resource's vault; emit `PrizeDepositedEvent`. Anything else aborts the transaction, so the bucket never lands. |
| `award_prize(resource, amount_or_ids) -> Bucket` | `admin` or OWNER (R5: no automated awarder) | assert not paused; resource accepted under the same rule; take from vault; emit `PrizeAwardedEvent`; **per-call cap for `admin` (value UNKNOWN, ruling needed)**; OWNER uncapped |
| `withdraw_prize(resource, amount_or_ids) -> Bucket` | OWNER only | recovery and wind-down path; works while paused and for disallowed resources; emits `PrizeWithdrawnEvent` |
| `allow_resource(addr)` | OWNER only | aborts if `addr` is in `forbidden`, is XRD, or is one of the vault's own badge addresses; emits `AllowlistChangedEvent` |
| `disallow_resource(addr)` | OWNER only | blocks new deposits/awards of `addr`; holdings stay and stay withdrawable by OWNER |
| `set_paused(bool)` | `admin` or OWNER | blocks `deposit_prize` and `award_prize`; never blocks `withdraw_prize` |
| getters | PUBLIC | `get_allowlist`, `get_holdings` (resource, amount or id count), `is_paused`, `get_badges` |

Owner role: `OwnerRole::Updatable(require(owner badge))`, never `Fixed` (`docs/VAULT-V1-LOST.md`,
"The lesson worth keeping"). The doc comment in `scrypto/meme-token/src/lib.rs` already records that `Updatable` is rotation,
not loss recovery; the same caveat applies here and the two-owner-badge split is what addresses loss.

There is **no** method that accepts a bucket and returns it unchecked, and **no** `deposit_batch`
style catch-all. A component has no account-style receive path (§2.2, INFERRED, tested per §4.1), so the only way a resource
enters is a method call, and every such method checks the allowlist first.

### 3.3 Allowlist shape: env vs on-ledger

| | On-ledger (enforcing) | Server env `NFT_PRIZE_RESOURCE_ALLOWLIST` (mirror) |
|---|---|---|
| Enforces at deposit | yes (component assert) | no |
| Changed by | OWNER transaction (cold or backup badge) | operator edits box env, restart |
| Failure if wrong | wrong entry = a resource we did not review can enter; fixable only by `disallow` + owner withdraw | wrong entry = display or award preflight is wrong; ledger still enforces |
| Who can read it | anyone (Gateway state read) | nobody outside the box |

Rules for the mirror, to implement later:
- Server boot reads the component's `get_allowlist` (Gateway state read) and **refuses to enable
  award or the public pool** unless `env ⊆ on-ledger`. An env entry the ledger does not allow is the
  case the current code cannot detect, because today's filter has nothing to compare against.
- `env` unset or empty stays fail-closed, as `prize-allowlist.ts` does today (its tests pin this).
- `assertAllowedPrizeResources` becomes a mandatory pre-flight inside any manifest builder that
  touches the vault. Its existing doc comment already says this; today nothing calls it.

### 3.4 Custody mapping

Mirrors the v2 vault's mapping by **role**, not by account (accounts are in the operator's private
sheet and stay out of this repository).

| Authority | Badge | Held by (role) | Can |
|---|---|---|---|
| OWNER | owner badge ×2 | cold + backup (distinct accounts) | `allow_resource`, `disallow_resource`, `withdraw_prize`, rotate owner/admin rules, `set_paused` |
| `admin` | admin badge | warm ops account | `set_paused`, `award_prize` (capped). **Cannot** withdraw or change the allowlist. A compromised admin key can pay out prizes up to the cap, so the admin account is a prize-custody account, not just a pause switch |
| `awarder` | not built (R5 = no) | n/a | `award_prize` within caps. A compromised server key can drain prizes up to the caps; it cannot touch the allowlist, pause state or owner |
| depositor | none | anyone | `deposit_prize` of allowlisted resources only |

Two badge options (ruling R2):
- **A. Reuse the v2 vault's owner and admin badge resources** as the prize vault's owner rule and
  admin role. No new custody to map; the same two owner accounts and one admin account already
  proven by the v2 `verifyCustody`. Cost: the prize vault can only be instantiated after the v2
  vault exists, and one lost owner badge affects both components.
- **B. Mint a fresh owner×2 / admin×1 set** for the prize vault, deposited to three distinct accounts
  by the same placement pattern. Cost: a second custody mapping to prove, one more row set in the
  operator's registry.
Recommendation: **A**, because the point of the v1 lesson is fewer unproven custody facts, not more.
This is a recommendation, not a finding; SPECULATIVE that it is the better trade until the owner
weighs the shared-loss cost.

`forbidden` at instantiate should contain: the v2 owner, admin badge addresses; the achievement NFT
collection's owner and minter badge addresses; the v1 owner/admin badge address. This is a
backstop for operator error in `allow_resource`. It cannot cover a badge created later, which is why
the claim in §3.1(6) rests on the unlisted-fungible rule plus this list, and a future non-fungible badge must be added here in the change that creates it.

### 3.5 Awarding, and the hot key

R5 is ruled **no**: there is no `awarder` badge and no server-driven award in v1. Awards are signed by the admin (capped) or an owner. For reference, the only automated actor in the repo today is the hot signer (`BOT_PRIVATE_KEY`). Giving it an
`awarder` badge turns "server key compromised" from "the prize treasury is the hot account and the
minter badge shares it" (today) into "prizes up to the cap per window". The cap numbers are UNKNOWN
(UNKNOWN, no longer needed). The component ships without `awarder`, which removes the hot key's **prize-award** exposure (the hot account still holds the NFT collection's minter badge, §1.4) at the cost of operator hands per award, consistent with "no on-chain draw or raffle path exists" in `STATE.md`.

### 3.6 Failure modes

| Failure | What happens | Mitigation | Residual |
|---|---|---|---|
| Allowlist wrong at instantiate (extra entry, especially a fungible) | that resource can enter | `get_allowlist` read-back before any funding (§3.7); `disallow_resource` + `withdraw_prize` | anything deposited in the window is recoverable only by OWNER |
| Allowlist wrong (missing entry) | deposits of that resource abort | none needed; `allow_resource` | none: fails closed |
| A gifted third-party NFT is itself someone's authority badge | that party's authority sits in our vault; a role rule elsewhere may then be unsatisfiable until OWNER withdraws it | harm is to the donor's own rules, not ours; OWNER `withdraw_prize` can return it | **UNKNOWN** how often; nothing on-ledger identifies it (§2.1) |
| Spam, offensive or malicious third-party NFTs | vault fills with junk; public pool display renders attacker-chosen name and icon | OWNER can `disallow_resource` and withdraw; R11 limits what the public page renders | storage cost to the vault is UNKNOWN until stokenet |
| A tier-1 resource is used as a badge by something | a prize deposit could put authority inside the vault | the two tier-1 resources are ours; their roles are in this repo: ROLLS roles use `global_caller(component)`; the NFT collection's minter/burner use `global_caller` / `deny_all` **in the current `scrypto/meme-nfts/src/lib.rs` source; the live collection was deployed from older v1-style rules (that file's comments, about lines 155-175) that gate minting on badge presence**. In both versions no role rule we wrote requires the collection resource or ROLLS, so the conclusion holds, but it is read from source, not from the deployed collection | none known |
| ROLLS paid out as a prize is later burned via the game vault | normal path | ROLLS burn is component-gated, unaffected | none |
| `award_prize` abused by a compromised `admin` key | caps limit loss | per-call cap; OWNER pauses (admin could re-unpause) and rotates the admin rule | cap sizing UNKNOWN |
| Owner badge lost (one of two) | other still works | two owner accounts, `Updatable` rule: rotate | both lost = stuck, same as any `Updatable` owner role |
| Env mirror drifts from ledger | server refuses to enable pool | boot check §3.3 | operator sees "disabled", not wrong data |
| Donor sends an unlisted fungible, or a forbidden resource | transaction aborts, nothing moves, donor pays the fee | none needed | donors who expected an account-style address are confused; the public copy must say "use the app's gift flow" and "NFTs only" (R10) |
| Package defect | cannot be patched in place | stokenet rehearsal, ledger tests, Tier A review, WASM hash read-back | a redeploy and migration of holdings by OWNER withdraw |

### 3.7 Read-backs that prove the claim on the Gateway

All pinned to one `state_version` and recorded with that number. What the Gateway can show is in
§2.5; what it cannot show is in §3.8.

1. **Code** (UNKNOWN until the stokenet run, §2.6): `/state/package/page/codes` for the component's
   package returns `code_hash_hex` and `code_hex`. The compare against the CI artifact (built from the
   pinned commit) uses either the same hash function, once identified, or the raw bytes. The CI
   `SHA256SUMS` stays what it is: the attestation "these files were built from commit X", not an
   on-ledger proof.
2. **State**: `/state/entity/details` for the component returns its state fields; `allowed` and
   `forbidden` are `IndexSet`s inside it. Expected: `allowed` is exactly the two tier-1 addresses.
   The field shape in the response is **UNKNOWN** until stokenet.
3. **Roles**: `/state/entity/details` for the component (role assignments: owner rule `Updatable`
   requiring the owner badge, `admin` requiring the admin badge) plus `/state/package/page/blueprints`
   for the blueprint definition (method to role mapping). Both response shapes are **UNKNOWN** until
   stokenet (§2.5); until then this read-back is a plan, not an established proof.
4. **Holdings** (`/state/entity/details` with `aggregation_level` `Vault`, plus `/state/entity/page/non-fungible-vaults` for NFT ids): every fungible vault's resource ∈ allowlist; every non-fungible vault's resource ∉
   `forbidden`; and explicit zero-balance reads for each known custody badge address (v2 owner, v2
   admin, NFT owner, NFT minter, v1 badge).
5. **Custody** (`/state/entity/details` on the three accounts, pinned to the same `state_version`): owner×2 / admin×1 sit in three distinct accounts, deployer holds none
   (the existing `verifyCustody` shape).
6. **Optional negative proof** (OWNER OK needed, ruling R8): a transaction **preview** (dry run,
   nothing submitted) that tries to `deposit_prize` an owner badge from an account holding one; the
   expected result is an abort with the unlisted-fungible assertion. UNKNOWN whether preview with assumed
   signatures is available for this on mainnet; fall back to the stokenet run.

### 3.8 What the Gateway cannot prove

- It shows **current** holdings and **current** code, not that no badge ever sat inside earlier. For
  "never": the ledger transaction stream for the component (deposit events) is the history, and the
  acceptance rule is the reason no unlisted fungible could have entered. The claim is code plus
  hash-matched artifact plus tests, not a single read.
- It does not tell you a resource "is a badge" (§2.1). It cannot validate that a gifted
  third-party NFT is not referenced by someone's role rule.
- It does not prove the source on GitHub is what was published unless the artifact hash step in §4
  is done and recorded.

### 3.9 Rollback

There is no un-deploy. Rollback is reversing exposure, in this order, as notes for the sitting
sheet and **not as runnable blocks**:
1. Admin pauses the component (blocks deposit and award).
2. Server: unset the pool env so `GET /api/vault/nfts` and any award path go dark (the same
   reversible flip the v2 vault uses).
3. OWNER withdraws all prize holdings to an owner-controlled account via `withdraw_prize`.
4. The component stays on the ledger, paused and empty. Its address is recorded as retired, like
   v1 in `docs/VAULT-V1-LOST.md`.
## 4. Plan

Lane-hours are **ESTIMATES** from this repo's earlier blueprint and deploy work; no measurement
backs them. One lane = one agent session in its own worktree. Nothing starts before the rulings in §5.

| # | Step | Output | Estimate (lane-h) |
|---|---|---|---|
| 0 | Owner rulings R1 to R9 (§5) | yes/no each | owner |
| 1 | Spike in a ledger test: confirm `put` mismatch behaviour, `KeyValueStore<ResourceAddress, Vault>`, non-fungible withdraw by id on the pinned scrypto 1.3.x; and that no manifest route places a foreign resource in a component | notes in the PR | 2 |
| 2 | Blueprint `scrypto/prize-vault` per §3.2, events, `forbidden` set, doc comments in the repo's style | blueprint, `cargo check` green | 4 to 6 |
| 3 | Ledger tests (list below) | tests in `scrypto/prize-vault/tests` | 5 to 7 |
| 4 | Server: `deploy-prize-vault.ts` mirroring the v2 custody rules (three distinct accounts, deployer holds none, read-back); allowlist mirror boot check; manifest builders that call `assertAllowedPrizeResources`; no award route unless R5 is yes | server code and tests | 6 to 8 |
| 5 | Docs and public copy: `STATE.md`, `PROVENANCE.md`, the tokenomics "gift an NFT" section (R7a, R7b, R10), `.env.example` | docs | 2 to 3 |
| 6 | Reproducible artifact: CI wasm+rpd for the pinned commit, `SHA256SUMS` recorded as the built-from-commit attestation, compared with a `scrypto-builder` build and, after deploy, with the on-ledger code as read in §3.7(1) (method UNKNOWN until stokenet) | recorded hashes | 2 to 3 (shares the ruling-6 "CI-artifact" PR with the v2 vault) |
| 7 | Stokenet rehearsal, three distinct test accounts, including the negative deposit | transcript | 2 to 3 plus owner time |
| 8 | Tier A review in a separate session | `agent/reviewed` | 3 to 4 |
| 9 | Owner sitting (fence names below) | read-backs recorded | owner |

Total about 26 to 36 lane-h (sum of rows 1 to 8), **ESTIMATE**. It could move if step 1 finds a surprise.

### 4.1 Test list (ledger tests, written at step 3)

1. Deposit of an allowlisted fungible and an allowlisted NFT succeeds; holdings read back match.
2. Deposit of a non-allowlisted resource aborts, and the bucket's resource is unchanged in the sender.
3. Deposit of each custody badge (vault owner, vault admin, collection owner, collection minter) aborts.
4. XRD deposit aborts (not allowlisted).
5. No manifest route puts a foreign resource into the component other than the checked methods
   (covers the INFERRED claim in §2.2).
6. `award_prize` and `withdraw_prize` fail for the wrong role; admin can award within the cap but cannot withdraw or change the allowlist.
6a. Tier 2: a third-party NFT is accepted; a third-party fungible is rejected; an NFT on `forbidden` is rejected.
7. `allow_resource` rejects XRD, `forbidden` entries and the vault's own badges; works for OWNER only.
8. `disallow_resource` blocks deposit and award, and OWNER can still withdraw that resource.
9. Pause blocks deposit and award; does not block `withdraw_prize`.
10. Admin per-call cap: an award over the cap aborts; OWNER is not capped.
11. Owner role is `Updatable`; rotating the owner rule works and the old badge stops working.
12. Instantiate refuses an empty or duplicate allowlist (fail closed).
13. Events emitted for every state change.
14. Server unit tests: mirror subset check (env ⊆ ledger), unset env fails closed, mismatch disables the pool.

### 4.2 Sitting fences (names only; written after the rulings, values supplied at the sitting)

P0 read-only facts · P1 artifact fetch and hash · P2 publish preview for the fee · P3 fee funding
(owner wallet) · P4 deploy and badge placement (or R2-A wiring) · P5 on-ledger read-backs (§3.7) ·
P6 server env and restart (owner edits the env) · P7 first allowlisted deposit and read-back ·
P8 negative-case proof (R8) · P9 registry rows and docs PR.

## 5. Owner rulings

R1 to R9 were answered by the owner in chat on 7 Nov 2026. R6 changed the design (open third-party
NFT gifts), which raises R10 and R11; both are still open.

| # | Question | Recommendation | Owner answer, 7 Nov |
|---|---|---|---|
| R1 | Separate package and component, not a method on the v2 vault? | Yes | **Yes** |
| R2 | Reuse the v2 owner×2 / admin badge resources (option A) rather than a new set (B)? | Yes (A) | **Yes** |
| R3 | Allowlist on-ledger and OWNER-appendable? | Yes | **Yes** |
| R4 | `deposit_prize` PUBLIC? | Yes | **Yes** |
| R5 | Automated `awarder` badge in the hot server key? | No for v1 | **No** (as recommended) |
| R6 | Restrict to the two allowlisted resources, third-party NFTs out of scope? | Yes | **Reversed: allow third-party NFT deposits** ("why restrict?"). Recorded as tiers in §3.1(5) |
| R7a | Retire the public "gift an NFT" copy? | Yes | **"See 6"**, read as **No**: gifting stays open (reading, to confirm) |
| R7b | Stop publishing the hot account as the pool treasury address? | Yes | **open**, tied to R10 |
| R8 | Mainnet preview negative test acceptable? | Yes | **Yes** |
| R9 | Prize vault deploys in a later sitting than the v2 vault? | Yes | **Yes** |
| R10 | The gift copy points at the vault's app gift flow and says "NFTs only"? | Yes | **open** |
| R11 | Public pool page shows third-party NFTs by count only (no attacker-chosen name or icon rendered) until the owner reviews a resource? | Yes | **open** |

## 6. Not decided here

- Cap sizes for awards (UNKNOWN).
- Whether ROLLS should be renamed in public copy (§1.1).
- Access Controller for the cold owner badge (the v2 blueprint comments call it ideal; the registry
  has no such account, per the operator's sheet).
- Raffle or draw logic: no on-chain draw path exists (`STATE.md`) and none is designed here.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
