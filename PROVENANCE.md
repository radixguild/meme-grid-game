# Provenance

See [`STATE.md`](./STATE.md) for what is live, what is switched off and what is disclosed, kept
current.

## Where this came from

MEME GRID was written by one operator (`bigdev`, GitHub
[`@bigdevxrd`](https://github.com/bigdevxrd)) using AI coding agents as the primary
implementation tool, between April and October 2026, as a companion game to the
[Radix Guild](https://radixguild.com).

The repository this file ships in was extracted from a private predecessor (`meme-grid-game`,
same owner) as a **single squashed commit**, not that repository's full development history.
That is a deliberate choice, not an attempt to obscure how the code was written: development
happened across some 170 commits and 76 pull requests, many of them authored by automated agent
tooling rather than a human typing directly, all of it operated by the one copyright holder.
Squashing to one commit avoids publishing an authorship trail that would misrepresent who is
answerable for the code, and it means the published history contains no revision that was never
meant to be read by a stranger. The single public commit is authored and committed as
`bigdev <bigdevxrd@users.noreply.github.com>` — the GitHub account of the copyright holder —
because everything in it, whichever tool produced the diff, was directed by and is owned by that
one person.

The private repository is not deleted or rewritten by this. It is kept, unpublished, by the
operator, because this project's own documents (`docs/GAME-DESIGN-REVIEW.md`,
`docs/VAULT-V1-LOST.md`, and the many code comments that cite "PR #N" or "PROJECT-STATE item N")
refer to commits, pull requests and a working record from that history. Keeping it lets such a
citation still be resolved by someone with access; it grants no one else any claim on it, and
nothing in it is part of what this repository ships. The published tree is a curated subset of
the private tree at the commit it was exported from: the application, server, blueprints, tests,
CI and the documents the README lists ship; operational runbooks, deploy and backup scripts,
dated audit records, drafts and the maintainer's working record stay private.

## Licence

**The Apache License, Version 2.0**, across the blueprints, the server and the app — see
[`LICENSE`](./LICENSE). The patent grant is the reason it was chosen over MIT for code that
custodies and mints on-chain assets.

## Who holds authority over the deployed assets, today

One person, `bigdev`, holds all of it:

- **This repository's admin access.** No committed transfer date exists.
- **The achievement-NFT collection's minter badge** sits in the server's hot signing account —
  the account `GET /api/vault/nfts` publishes as `treasury_address` — and the collection's owner
  badge sits in a cold account the operator controls. What each badge authorises is chain fact,
  not description: read `scrypto/meme-nfts/src/lib.rs` and the resource's role assignments from
  the Radix Gateway.
- **The v1 purchase vault's owner and admin badge** sits in an account whose key the operator
  holds. That key could not be found from 2026-08-20 until it was located on 2026-09-17. The
  owner rule's updater is `None`, so owner authority over the component moves only with the
  badge; the badge holder can re-point the component's `admin` role to another badge, and nobody
  else can. The badge has not moved and the vault's 160 XRD has not been withdrawn; the plan is
  to move the badge to another operator-held account and withdraw from there. The vault's
  addresses are recorded in `server/deploy-state.json` and the failure is documented in
  [`docs/VAULT-V1-LOST.md`](docs/VAULT-V1-LOST.md).
- **The v2 vault is not deployed**, so nobody holds authority over it yet. Its deploy script
  refuses to run on mainnet until the operator supplies three distinct custody accounts through
  environment variables. `server/.env.example` lists those variables with placeholders only: this
  repository names no custody account as a default or a value to deploy with, and the operator
  chooses the three at deploy time.
- **The game's dApp definition**
  (`account_rdx12945s526fxx2c6faj3pykzl6jgl90mhwtnnsgp773r3rp37cstq4lx`) is an operator-held
  account.
- **There is no other legal entity.** No company, no foundation, no DAO, no token sale.

This is a statement of present fact, not a plan to keep it this way.

## What is provisional in this file

- The specific accounts behind "operator-held", beyond the ones the live API and the shipped
  configuration already publish, are deliberately not enumerated here for operational-security
  reasons, and this file does not verify any of them against a live chain read. Treat a specific
  claim as provisional until confirmed against the Radix Gateway.
- The commit and pull-request counts above describe the private history at the time of export
  and are not updated afterwards.
