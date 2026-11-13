# State

**This page says what is true. If any other document in this repository — the README, a design
doc, a code comment — disagrees with this page, this page wins**, per the rule in
[`CONTRIBUTING.md`](./CONTRIBUTING.md). It is a short digest of the maintainer's working record,
`docs/PROJECT-STATE.md`, which does not ship in this repository: it carries commit-level
citations, deploy records and a working history that are only useful with the full development
history in hand. Code comments that cite "PROJECT-STATE item N" refer to it. This page carries
the conclusions, not the derivation.

_Last written: 2026-11-07 (AEDT). Re-read on 2026-11-06: the deployed commit, the live site's public health endpoint,
`GET /api/token/info`, `GET /api/vault/nfts`, the response headers and `/gift`; and, on the
Radix Gateway (ledger state version 567581462), the NFT collection's supply and the v1-vault
entry. Everything else stands as written on 2026-10-13 against the live site's public API, the
deployed commit and `docs/PROJECT-STATE.md`, and was not re-read on 2026-11-06. Edited
2026-11-13 to record that day's deploy and the owner's read-back after it (the values named
in "Deployed build"; nothing else was re-read), and for code changes on `main` that are not
yet deployed (marked "not yet deployed" below)._

## Right now *(as of 2026-11-06, except where a line gives a later date)*

- **Deployed build.** Commit `dad57e5157ac5bd49ef58e2a4d97bfd80b44df02` of this repository was
  deployed to the live site on 2026-11-13 (server restarted at about 05:19 UTC). Read back by the
  owner that day after the restart: migration 017 applied, `NFT_MINT_DAILY_CAP` set to 10, no
  guest id on the public leaderboard, `GET /api/vault/nfts` returning `treasury_address: null`,
  and the public health endpoint reporting 43 player rows and 16 boards. The previous deploy was
  commit `e445b4008fc88a4da5e07644b0e42de124a22ba6` on 2026-11-06, when the deploy directory
  became a checkout of this public repository (before that it was a private history repository
  with a local patch). This describes those days; it is not re-read automatically.
- **Live and maintained; feature work resumed 2026-11-07 (AEDT).** The game is deployed at
  [memegrid.radixguild.com](https://memegrid.radixguild.com) and playable. Its public health
  endpoint reported 43 player rows and 16 boards ever started on 2026-11-13, the same 16 as on
  2026-10-04, so no new board has been started since then; seven NFTs have been minted in total (the collection's
  supply on the Radix Gateway is 7, none burned). Currently there is no marketing or community
  programme. Next: the v2 vault and prize vault deploy, an operator sitting not yet
  scheduled. The repository is published as a working reference of what can be built on Radix.
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
  path exists in the code — the on-chain send is a `TODO`. Since the 2026-11-13 deploy the
  route also publishes no address at all when `NFT_TREASURY_ACCOUNT` is the server's signing
  account or holds a known custody badge, or when it cannot check either (production returns
  `treasury_address: null`, read back that day), and `/tokenomics` no longer shows a prize-pool
  or donation section. On `main` (not yet deployed) that check also refuses when
  `deploy-state.json` cannot be read or a Gateway reply is malformed, reads every page of the
  account's holdings up to a page limit instead of refusing any account with more than one
  page, and serves its last answer through a Gateway outage for at most ten minutes.

## Live today

- **Play:** boards, rolls, lines, patterns, combos, levels, streaks, power-ups, the daily board,
  the leaderboard, guest play. Server-authoritative; randomness never leaves the server. Since
  the 2026-11-13 deploy the public leaderboard lists wallet accounts only, never a guest id
  (read back that day: none listed).
- **Wallet sign-in** via ROLA (Radix Off-Ledger Auth). The client requests persona and account
  proofs on connect; the server verifies them against the game's own dApp definition
  (`account_rdx128dfwn2l5us32hsglczh92mm3kn44ypefkmlv8kuyj0we5304jntfs`) and issues a session.
  Funding and spend routes require a proven session for wallet addresses
  (`required-for-wallets`). Guests are server-issued, HMAC-signed ids, metered per IP.
- **Achievement NFT minting** on Radix mainnet, from the game's own collection to the player's
  wallet, signed by a server-held key. 13 of the 23 catalogued NFTs are obtainable.
  Since the 2026-11-13 deploy mints are capped per UTC day by `NFT_MINT_DAILY_CAP` (10 in
  production, read back that day): mints over the cap wait in the queue for the next day and
  are not marked failed. Unset on mainnet means paused (queued, none submitted).
- **Security headers** on every route of both halves; both processes listen on localhost only,
  behind a reverse proxy.

## Switched off or not built

- **XRD → ROLLS purchase.** Off. The v2 vault blueprint (`scrypto/meme-token`) is built and its
  ledger tests run in CI; deploying it is an operator sitting that has not happened. The deploy
  script (`server/src/services/deploy-meme-token.ts`) refuses to run on mainnet unless three
  distinct custody accounts are set — owner cold, owner backup, admin — none of them the
  deploying key. That rule is what the v1 vault failure produced.
- **The v1 vault is retired, and its 160 XRD was withdrawn on 2026-10-19.** Its owner and admin
  roles both resolve to one badge, and the owner rule can never be re-pointed. The key to the
  account that held that badge (`…z223v2x`) could not be found from 2026-08-20 until it was
  located on 2026-09-17; the operator holds it, and about 505 XRD that account held was moved to
  another operator-held account on 2026-10-04. On 2026-10-19 the badge moved from `…z223v2x` to
  another operator-held account (transaction
  `txid_rdx1ncfw8mgskr5xd4rfwahs4rdau6c035kwm4em4vnl3hy5gh5w6qdscu3rxk`), and about ten minutes
  later the vault's 160 XRD was withdrawn to that account
  (`txid_rdx1g4rjeg90szl4r3epev3gqdg0qlrj54s2kv42rn6ltg6rg03ajwgqgjxsz6`). A Gateway read on
  2026-11-06 shows the vault holding 0 XRD, not paused, with its owner and admin roles still
  requiring that badge. The component still accepts deposits from anyone who calls it directly;
  the game stopped routing any there on 2026-08-21 and has not routed purchases to v1 since. See
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
- **An enforcing Content-Security-Policy on the Next.js app.** The API sends one. The app's
  policy is sent as `Content-Security-Policy-Report-Only`, pinned by
  `src/__tests__/security-headers.test.ts`, and is live in report-only mode since the deploy
  above (read back on 2026-11-06: the public `/` answered 200 with that header, and
  `POST /api/csp-report` answered 204). A local sweep on 2026-11-06 (production build, home page
  and the opened Connect popover) logged no violations. Enforcing mode has not been turned on.
- **The gift rails** (`/gift`). No destination is configured, so the page is a 404 by design.

## Disclosures

- **The server's signing key is hot.** The same account signs NFT mints and holds the
  collection's minter badge. Until the 2026-11-13 deploy it was also what `/tokenomics` and
  `GET /api/vault/nfts` published as the prize-pool treasury; since then neither publishes it.
  The key and the badge it holds are unchanged. A dedicated prize vault that cannot hold badges
  is the planned fix and is not done. Do not send anything of value to that account expecting a
  vault to hold it.
- **The MEME token's and the NFT collection's `dapp_definitions` metadata is locked** to the
  Radix Guild's dApp definition, the game's original home, and can only change with a redeploy.
  The game's current dApp definition (since 2026-11-11) claims no entities, and the Guild's
  released them on 2026-07-18.
- **The free-ROLLS faucet is mitigated, not closed.** Fabricated addresses are rejected,
  first-time funding needs a proven session, and newly funded wallets per IP per day are capped;
  a real keypair with a real signing flow is bounded only by that cap.
- **Telemetry:** server errors go to Sentry when a DSN is configured. Nothing else is collected
  beyond what the game needs to run.

See [`PROVENANCE.md`](./PROVENANCE.md) for who holds what authority and why the public history
is a single commit.
