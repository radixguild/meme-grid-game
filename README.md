# MEME GRID — a Web3 dice game on Radix

**Live at [memegrid.radixguild.com](https://memegrid.radixguild.com).** An 8×8 grid, a weighted
d6, server-authoritative gameplay, and achievement NFTs minted to the player's wallet on Radix
mainnet. Built by one pseudonymous developer ([`bigdev`](https://github.com/bigdevxrd)) as a
companion to the [Radix Guild](https://radixguild.com). Apache-2.0.

> **Read [`STATE.md`](./STATE.md) first.** It says what is live, what is switched off and what is
> disclosed as a known limit, and it wins over this file wherever the two disagree. The short
> version: the game is live and playable, the paid economy is off, and the project is dormant
> while its next phase is decided.

## What it is

- Players start an 8×8 board for free, as a guest or with a connected Radix wallet, and roll a
  weighted d6 at **1 ROLL** per roll to reveal cells. A board takes roughly 95–100 rolls to
  finish and pays out lines, patterns, combos and XP across 10 levels (0 → 300,000 XP).
- **ROLLS** is a server-side balance, not a token you custody. A first visit is credited 15 ROLLS
  once; level-ups pay more; daily check-ins pay XP and power-ups only. There is no recurring
  faucet, and buying ROLLS with XRD is switched off (see "The v1 vault").
- **Achievement NFTs** mint to the player's wallet on Radix mainnet from the game's own
  collection. 13 of the 23 catalogued NFTs are obtainable today; the other 10 have unlock
  conditions that nothing implements yet.
- All game logic and randomness run server-side. The client never sees a roll before it lands.
- Guests play without a wallet: guest ids are issued and HMAC-signed by the server and metered
  per IP. Wallet players sign in with ROLA (Radix Off-Ledger Auth) proofs.

## Architecture

| Layer | What | Where |
|---|---|---|
| Frontend | Next.js 16, React 19, Tailwind v4, shadcn/ui; Radix dApp Toolkit for wallet connect | `src/` |
| API | Express 5 + better-sqlite3; ROLA sessions; a signing worker that mints NFTs | `server/` |
| On-chain | Two Scrypto blueprints: the ROLLS purchase vault (`meme-token`) and the achievement-NFT collection (`meme-nfts`) | `scrypto/` |

The server is authoritative. The chain holds only the assets: the NFT collection (live), the
MEME token and the v1 purchase vault that minted it (retired, see below), and the game's own
dApp definition (`public/.well-known/radix.json`). The addresses are in
`server/deploy-state.json`.

## Quick start

```bash
cp .env.example .env.local                 # NEXT_PUBLIC_* values for the frontend
npm ci && npm run dev                      # Next.js frontend on http://localhost:3005
```

```bash
cd server && cp .env.example .env          # RADIX_NETWORK is the only value the server needs to boot
npm ci && npm rebuild better-sqlite3 && npm run dev   # Express API on http://localhost:3004
```

`server/.env.example` documents every variable. Signing, ROLA and NFT minting switch themselves
off when their variable groups are absent, so a bare local server runs the game with no keys.
`.npmrc` sets `ignore-scripts=true` as supply-chain hardening; the explicit
`npm rebuild better-sqlite3` builds the one native module the server needs.

## Tests and checks

```bash
npm run lint && npm run type-check && npm run test:web && npm run build   # frontend — what CI runs
cd server && npx tsc --noEmit && npm test                                  # server suite
cd scrypto && cargo test --locked --no-fail-fast                           # blueprints — Linux only
```

The Scrypto tests compile the blueprints to `wasm32-unknown-unknown` and run them in the ledger
simulator. That build does not work on macOS (the comments in `.github/workflows/ci.yml` say
why), so CI on Linux is where a green blueprint result means something.
`scrypto/rust-toolchain.toml` pins the compiler.

## Repository layout

```
src/            Next.js app: pages, components, hooks, the gift-rail address guard
server/src/     Express API: auth (ROLA, guest ids), game engine, routes, services, SQL migrations
scrypto/        meme-token (vault) and meme-nfts (collection) blueprints with ledger tests
docs/           the game design review, the engagement strategy, the v1 vault post-mortem
public/         static assets, cell art, the dApp definition well-known file
.github/        CI (frontend, server, Scrypto) and the gitleaks secret scan
```

## The v1 vault

The first ROLLS purchase vault shipped with an owner role that resolves to a single badge, under
a rule whose updater is `None`, so the rule can never be re-pointed. When that was found on
2026-08-20, the key to the account holding the badge could not be found either, so the vault —
which still accepts deposits — could be neither paused nor withdrawn from. Inflow was stopped on
2026-08-21. The key was located on 2026-09-17, and about 505 XRD that account held was moved to
another operator-held account on 2026-10-04. The vault's own 160 XRD has **not been withdrawn**,
and on 2026-10-11 the operator decided to leave it there: the badge stays where it is and no
recovery is planned.
The addresses are recorded as tombstones in `server/deploy-state.json`, and the v2 blueprint in
`scrypto/meme-token` carries the fix: a recoverable owner role, and a deploy script that refuses
to run without three distinct custody accounts. The v2 vault is **not deployed**, so buying ROLLS
with XRD is off. Full account: [`docs/VAULT-V1-LOST.md`](docs/VAULT-V1-LOST.md).

## Contributing, security, provenance

- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — how changes land, what CI checks, which package
  manager each directory uses.
- [`SECURITY.md`](./SECURITY.md) — private disclosure for anything that could move funds, mint
  an NFT it should not, or bias a roll.
- [`PROVENANCE.md`](./PROVENANCE.md) — where this code came from, why the public history is one
  commit, and who holds what authority over the deployed assets.
- [`LICENSE`](./LICENSE) — Apache License 2.0.
