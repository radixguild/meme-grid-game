# Vault v1 — owner badge stranded, 160 XRD not yet recovered — post-mortem and tombstone

> **Correction, 2026-10-06 (balances re-read from the Radix Gateway on 2026-10-08).** The
> 2026-08-20 finding that no key controlled `…z223v2x`, the account holding this vault's owner
> badge, was wrong. The key was located on 2026-09-17 and verified by derivation: it derives that
> address and is its sole on-chain controller, and the operator holds it. On 2026-10-04 the
> operator moved about 505 XRD out of that account to another operator-held account. The account
> still holds the owner badge (×1) and a small XRD fee reserve, and the vault still holds
> **160 XRD**. The operator's plan is to move the badge to another operator-held account and
> withdraw the 160 XRD from there. **Neither step has been taken yet.** What stands: the owner
> rule can never be re-pointed, the two-vault confusion, the design lesson, and the inflow cut —
> the game stays off v1. The main superseded sentences are quoted verbatim under "Correction
> history" at the end of this file.

**Established 2026-08-20 by on-chain reads plus a key-derivation check; the no-key finding was
overturned on 2026-09-17 (above). This file exists so nobody re-adds these addresses, and so the
rule at the end never has to be re-learned.**

## Two vaults, not one

There are **two** v1 vaults on mainnet, both with an immutable owner rule. Only one ever carried
traffic, and for a while `server/deploy-state.json` recorded *the other one* — so the file naming
the production vault was naming the wrong component. Both verified by Gateway read 2026-08-21;
both have owner role `updater: "None"`.

| | component | MEME resource | MEME supply | XRD |
|---|---|---|---|---|
| **PRODUCTION** (the one that matters) | `component_rdx1czh262wvmm8zpmq4el98v50557f7zu5ge6yp64cqhjecl72tj6lgxy` | `resource_rdx1t4trlp2hwzlt60g9g2mfwetlpt62zqg2kxl6hdsmvl7tq63y6sdrl7` | 160 | **160** |
| never used | `component_rdx1czzugtuaus06530ylshhxz5a2vzeah43agu5a7emg0cgekpu040cs5` | `resource_rdx1tk6hk47dw9ad3f8g5snc2acv32qpkrtkaa3k0jn2rq9gnzxq6ghdp2` | 0 | 0 |

The production pair is the one the live server's `MEME_RESOURCE` matched and what
`/api/token/info` served. `deploy-state.json` now carries both as `memeTokenV1Dead` /
`memeTokenV1Unused` tombstones and the deploy script keys off `memeTokenV2`, so a dead deployment
cannot be reused.

## The retired entities

| Thing | Address |
|---|---|
| v1 vault component | `component_rdx1czh262wvmm8zpmq4el98v50557f7zu5ge6yp64cqhjecl72tj6lgxy` |
| its owner + admin badge | `resource_rdx1t42g9rxmpq7e07mdtzeha49t6fyvyy4ftwwh2qfzymdse2a0qtugls` |
| the account holding that badge | `account_rdx12xgra93fqw4u0nmwhlu5rs7f5gvg807rstd54kxwwy2alhxz223v2x` |

## Why the badge is the only way back

On the live `MemeGameVault` component, **both** roles resolve to that one badge:

- `owner` → requires the badge, and its rule carries **`updater: "None"`** — immutable, so the
  rule can never be reassigned to any other badge.
- `admin` → requires the same badge, and is `updatable_by: [OWNER]` — so only a proof of that
  badge can re-point it.

`set_paused` and `withdraw_xrd` are `restrict_to: [admin, OWNER]`. Today only a proof of that one
badge can call them. Whoever holds the badge can re-point `admin` to a different badge, and that
badge's holder could then call them too; the owner rule itself can never change. Metadata setter
and locker are owner-derived, so they follow the badge. Recovery therefore goes through a proof
of the badge, never through changing the rule.

When the problem was found on 2026-08-20, every wallet, signer and backup the operator held was
checked by deriving each key's account address and comparing; none derived to `…z223v2x`. That
search missed it: the key was located on 2026-09-17. One configuration file had also paired the
address with a key that in fact derives to a different account — a mislabel that misled one
investigation. An env pairing is not proof of custody, and a search that finds nothing is not
proof that a key does not exist; derive it.

## It is not an outage — which is what made it dangerous

`buy_meme` and `burn_meme` are **public**. The game kept working normally, and **every MEME
purchase routed more XRD into a vault nobody could then drain.** About 160 XRD sat in the vault
at discovery, and the same 160 XRD sits there today. The account holding the badge held a further
~510 XRD of its own, counted at the time as equally unreachable; once its key was found, about
505 XRD of that was moved to another operator-held account on 2026-10-04. Not a financial
emergency at any point, but structural and, until the cut below, accumulating.

## The cut

1. **Inflow stopped, 2026-08-21.** `VAULT_COMPONENT` was blanked in the production server
   environment. `phase` is computed as `VAULT_COMPONENT ? 2 : 1` (`server/src/routes/token.ts`),
   and the shop gates on `phase === 2 && vault_component` from the **API** value rather than any
   client constant, so unsetting the server variable dropped the app to phase 1 and the buy path
   disappeared cleanly. `GET /api/token/info` has reported `vault_component: null, phase: 1`
   since.
2. **No hardcoded fallback.** `src/lib/constants.ts` used to default `VAULT_COMPONENT` to the
   dead address, so clearing the env would have silently resurrected it. It is now `""`.
3. **Tombstone, do not delete.** The addresses stay recorded here and in `deploy-state.json` so
   nobody re-adds them.
4. **The real fix is the v2 redeploy** with a recoverable owner role. `scrypto/meme-token`
   carries it, and `server/src/services/deploy-meme-token.ts` refuses to run on mainnet unless
   three distinct custody accounts are set and none of them is the deploying key, then verifies
   the badge placement on-chain before reporting success. It has not been deployed — see
   `STATE.md`.
5. **Recovering the vault's 160 XRD — pending.** The operator holds the key to `…z223v2x`, so a
   transaction signed with it can present the badge today. The plan is to move the badge to
   another operator-held account and withdraw from there; neither step has been taken.
   Recovering the XRD does not put v1 back into service — the game stays off it either way.

## The lesson worth keeping

`OwnerRole::Fixed` (an owner rule fixed to one badge, updater `None`) plus a single-badge admin
is a design with exactly one failure mode: lose the key to the account holding that one badge,
and nothing else can ever reach the vault. It happened here. What made the 160 XRD recoverable
again was finding a key, not anything in the design. Any future blueprint gets a recoverable
owner role and a role rule whose updater is not `None`, or it does not ship.

## Correction history

**2026-10-06 — the 2026-08-20 no-key finding overturned.** The key to `…z223v2x` was located on
2026-09-17 (see the correction at the top). The main 2026-08-20 sentences below are superseded.
They are quoted verbatim, as excerpts, so the error stays visible; do not read any of them as
current.

> Title: "Vault v1 is permanently ownerless — post-mortem and tombstone"
>
> "**Established 2026-08-20 by on-chain reads plus a key-derivation check. Not reversible.**"
>
> "There are **two** ownerless v1 vaults on mainnet."
>
> Heading: "Why it cannot be fixed"
>
> "`owner` → requires the badge, and its rule carries **`updater: "None"`** — immutable, so the
> rule can never be reassigned to a badge anyone holds."
>
> "`admin` → requires the same badge, and is `updatable_by: [OWNER]` — the same lost badge."
>
> "`set_paused` and `withdraw_xrd` are `restrict_to: [admin, OWNER]`. Both are therefore
> **permanently unreachable.** Metadata setter and locker are owner-derived, so metadata is frozen
> too."
>
> "**No key exists for `…z223v2x`.** Every wallet, signer and backup the operator holds was
> checked on 2026-08-20 by deriving each key's account address and comparing; none derives to it."
>
> "**every MEME purchase routed more XRD into a vault nobody can drain.** About 160 XRD sat in the
> vault at discovery, and the keyless account itself holds a further ~510 XRD, equally
> unreachable. Total stranded ≈ **670 XRD**"

**2026-10-08 — the design lesson named the wrong owner role.** It read "`OwnerRole::None` plus an
immutable role rule plus a single-badge admin". v1 was instantiated with `OwnerRole::Fixed`, an
owner rule fixed to the badge with updater `None`, as `scrypto/meme-token/src/lib.rs` records.
`OwnerRole::None` would have denied the owner role to everyone.
