# State

**This page says what is true. If any other document in this repository — the README, a design
doc, a code comment — disagrees with this page, this page wins**, per the rule in
[`CONTRIBUTING.md`](./CONTRIBUTING.md). It is a short digest of the maintainer's working record,
`docs/PROJECT-STATE.md`, which does not ship in this repository: it carries commit-level
citations, deploy records and a working history that are only useful with the full development
history in hand. Code comments that cite "PROJECT-STATE item N" refer to it. This page carries
the conclusions, not the derivation.

_Last written: 2026-10-13, against the live site's public API, the deployed commit and
`docs/PROJECT-STATE.md`. The v1-vault entry was corrected on 2026-10-08 against the Radix
Gateway, and updated on 2026-10-13 for the 2026-10-11 decision. The usage figures below were
re-read on 2026-10-11 (the public health endpoint and the NFT collection's supply on the Radix
Gateway); nothing else was re-read then._

## Right now *(as of 2026-10-11)*

- **Live, and dormant.** The game is deployed at
  [memegrid.radixguild.com](https://memegrid.radixguild.com) and playable. Its public health
  endpoint reports 36 player rows and 16 boards ever started, the same 16 as on 2026-10-04, so no
  new board has been started since then; seven NFTs have been minted in total. There is no marketing,
  no community programme and no roadmap being executed. The project is frozen while its next
  phase is decided, and the repository is published as a working reference, not as a launch.
- **One pseudonymous developer (`bigdev`), working with AI assistance.** No company, no token
  sale, no treasury beyond the accounts named in [`PROVENANCE.md`](./PROVENANCE.md).
  Independent of, and not backed, endorsed or affiliated with, the Radix Foundation or RDX Works.
  It runs as a companion to the [Radix Guild](https://radixguild.com), by the same operator.
- **No independent audit** of the blueprints or the server. The only review on file is the
  operator's own, and the v1 vault defect below is the proof that the self-review missed things.
- **The paid economy is off.** Boards are free (`BOARD_COST` is 0), rolls cost 1 ROLL from a
  server-side balance, and ROLLS come only from the one-time 15-ROLL grant and level-up bonuses.
  Buying ROLLS with XRD is switched off: the v1 vault is retired and the v2 vault is not
  deployed. `GET /api/token/info` reports `vault_component: null` and `phase: 1`.
- **The NFT prize pool fails closed.** The server publishes a donation address and lists prizes
  held there only for resources named in `NFT_PRIZE_RESOURCE_ALLOWLIST`. That variable is unset
  in production, so `GET /api/vault/nfts` lists zero prizes by design, and no draw or raffle
  path exists in the code — the on-chain send is a `TODO`.

## Live today

- **Play:** boards, rolls, lines, patterns, combos, levels, streaks, power-ups, the daily board,
  the leaderboard, guest play. Server-authoritative; randomness never leaves the server.
- **Wallet sign-in** via ROLA (Radix Off-Ledger Auth). The client requests persona and account
  proofs on connect; the server verifies them against the game's own dApp definition
  (`account_rdx12945s526fxx2c6faj3pykzl6jgl90mhwtnnsgp773r3rp37cstq4lx`) and issues a session.
  Funding and spend routes require a proven session for wallet addresses
  (`required-for-wallets`). Guests are server-issued, HMAC-signed ids, metered per IP.
- **Achievement NFT minting** on Radix mainnet, from the game's own collection to the player's
  wallet, signed by a server-held key. 13 of the 23 catalogued NFTs are obtainable.
- **Security headers** on every route of both halves; both processes listen on localhost only,
  behind a reverse proxy.

## Switched off or not built

- **XRD → ROLLS purchase.** Off. The v2 vault blueprint (`scrypto/meme-token`) is built and its
  ledger tests run in CI; deploying it is an operator sitting that has not happened. The deploy
  script (`server/src/services/deploy-meme-token.ts`) refuses to run on mainnet unless three
  distinct custody accounts are set — owner cold, owner backup, admin — none of them the
  deploying key. That rule is what the v1 vault failure produced.
- **The v1 vault is retired, and its 160 XRD stays there by decision.** Its owner and admin
  roles both resolve to one badge, and the owner rule can never be re-pointed. The key to the
  account holding that badge could not be found from 2026-08-20 until it was located on
  2026-09-17; the operator holds it, and about 505 XRD that account held was moved to another
  operator-held account on 2026-10-04. The badge and the vault's 160 XRD have not moved
  (Gateway read 2026-10-13), and on 2026-10-11 the operator decided not to move them: no
  recovery is planned. The component still accepts deposits from anyone who calls it directly;
  the game stopped routing any there on 2026-08-21 and stays off v1 either way. See
  [`docs/VAULT-V1-LOST.md`](docs/VAULT-V1-LOST.md).
- **The 10 unreachable NFTs.** Their unlock conditions name stats that nothing computes, or a
  dispatcher that does not exist (`docs/GAME-DESIGN-REVIEW.md` §3). Do not read the catalogue
  as "earn all 23".
- **On-chain reward distribution ("phase 2").** Rewards are database rows. No raffle, draw or
  on-chain payout path exists.
- **Guild integration.** The game was designed as an engagement engine for the Radix Guild
  (`docs/GAME-MODEL-STRATEGY.md`). The feed that would credit Guild activity is designed, not
  built; nothing in this repository reads Guild data. The game has its own dApp definition, its
  own on-chain entities and its own signing key.
- **A Content-Security-Policy on the Next.js app.** The API sends one; the app needs a
  report-only sweep of the wallet-connect flow first.
- **The gift rails** (`/gift`). No destination is configured, so the page is a 404 by design.

## Disclosures

- **The server's signing key is hot, and it is the published donation address.** The same
  account signs NFT mints, holds the collection's minter badge, and is what `/tokenomics` and
  `GET /api/vault/nfts` publish as the prize-pool treasury. A dedicated prize vault that cannot
  hold badges is the planned fix and is not done. Do not send anything of value there expecting
  a vault to hold it.
- **The MEME token's and the NFT collection's `dapp_definitions` metadata is locked** to the
  Radix Guild's dApp definition, the game's original home, and can only change with a redeploy.
  The game's own dApp definition claims the entities in the other direction, and the Guild's
  released them on 2026-07-18.
- **The free-ROLLS faucet is mitigated, not closed.** Fabricated addresses are rejected,
  first-time funding needs a proven session, and newly funded wallets per IP per day are capped;
  a real keypair with a real signing flow is bounded only by that cap.
- **Telemetry:** server errors go to Sentry when a DSN is configured. Nothing else is collected
  beyond what the game needs to run.

See [`PROVENANCE.md`](./PROVENANCE.md) for who holds what authority and why the public history
is a single commit.
