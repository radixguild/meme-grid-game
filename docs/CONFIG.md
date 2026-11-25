# Configuration reference

Every environment variable the non-test code in this repository reads, with the file and line
that reads it. Names only: no values. Built from `process.env` reads in `src/`, `server/src/`
and `next.config.ts`. The repository has no shell scripts and no `os.environ` / `getenv` /
`import.meta.env` reads. Variables the CI workflows set for their own steps are not listed.

If this page and the code disagree, the code is right. Fix this page in a pull request.

**Column meanings.**

- *Required*: "boot" means the server exits at start without it (`server/src/config/env.ts:31-33`,
  `:110-124`). "group" means the server boots without it, but switches off a feature group and logs
  which names are missing (`server/src/config/env.ts:35-51`, `:126-132`). "optional" means the code
  has a default or skips the feature.
- *Kind*: "secret" means it grants an action or weakens a protection if it leaks. Keep it in
  `server/secrets.env` (see "Where the server reads from" below). "public" means it is safe to
  publish. Most public values are on-chain addresses or URLs.
- *Listed in*: which committed example file names it. "root" is `.env.example`, "server" is
  `server/.env.example`, and "—" means neither does.

## Where the server reads from

- `server/src/config/load-env.ts:20-38`: the server loads `.env` (it never overrides a value that is
  already set) and then `secrets.env` (which always overrides). It looks for both in the working
  directory and in `server/`. `ecosystem.config.cjs:5` starts the server with `cwd: "./server"`.
- `server/src/config/load-env.ts:101-108`: the server logs a warning if `secrets.env` has file
  permissions other than 0600 or 0400.
- `server/src/config/load-env.ts:73-81`, `:116-124`: under Node's test runner the server loads
  neither file, unless `NODE_ENV=production`. See `NODE_TEST_CONTEXT` below.
- The two deploy scripts (`server/src/services/deploy-nfts.ts:23-28`,
  `server/src/services/deploy-meme-token.ts:55-60`) load `server/secrets.env` and `server/.env`
  themselves, both without overriding a value that is already set.

## Frontend (Next.js, `src/`)

Next.js inlines `NEXT_PUBLIC_*` values into the bundle **at build time**
(`src/lib/gift/index.ts:48-55`). Set them before `npm run build`. A change needs a rebuild,
not just a restart. Every one of them ends up in the public JavaScript, so none can be a secret.

| Name | Read at | Required | Default in code | Kind | Listed in |
|---|---|---|---|---|---|
| `NEXT_PUBLIC_DAPP_DEF` | `src/lib/constants.ts:24` | optional | empty string | public | root, server |
| `NEXT_PUBLIC_VAULT_COMPONENT` | `src/lib/constants.ts:38` | optional | empty string | public | root, server |
| `NEXT_PUBLIC_MEME_RESOURCE` | `src/lib/constants.ts:49` | optional | empty string | public | root, server |
| `NEXT_PUBLIC_GATEWAY` | `src/lib/constants.ts:52` | optional | the public Radix mainnet Gateway URL | public | root |
| `NEXT_PUBLIC_NETWORK` | `src/lib/constants.ts:54` | optional | `mainnet` | public | root, server |
| `NEXT_PUBLIC_API_URL` | `src/lib/constants.ts:57` | optional | `http://localhost:3004/api` | public | root |
| `NEXT_PUBLIC_NFT_RESOURCE` | `src/lib/constants.ts:60` | optional | the game's NFT resource address (hard-coded) | public | — |
| `NEXT_PUBLIC_GIFT_XRD_ADDRESS` | `src/lib/gift/index.ts:54` | optional | empty string (gift rail off) | public | root |
| `NEXT_PUBLIC_GIFT_BTC_ADDRESS` | `src/lib/gift/index.ts:55` | optional | empty string (gift rail off) | public | root |
| `NEXT_PUBLIC_REWARD_PHASE` | `src/components/PhaseBanner.tsx:35` | optional | `1` | public | server |
| `NODE_ENV` | `next.config.ts:87`, `src/hooks/useWallet.tsx:186` | set by Next.js / pm2 | — | public | — |

`server/.env.example` also names `NEXT_PUBLIC_VAULT_COMPONENT`, `NEXT_PUBLIC_MEME_RESOURCE`,
`NEXT_PUBLIC_DAPP_DEF`, `NEXT_PUBLIC_NETWORK` and `NEXT_PUBLIC_REWARD_PHASE`. The server code
reads none of them. The server code deliberately does not read `NEXT_PUBLIC_NETWORK` (comment at `server/src/config/env.ts:63-68`).

## Server (Express, `server/src/`)

### Core and process

| Name | Read at | Required | Default in code | Kind | Listed in |
|---|---|---|---|---|---|
| `RADIX_NETWORK` | `server/src/config/env.ts:31-33,71`; also `services/signer.ts:15`, `auth/rola.ts:22`, `auth/address-validation.ts:42` | **boot** | none in `config/env.ts`. `signer.ts:15` falls back to `stokenet` and `rola.ts:22` to `mainnet`, but the boot check exits first | public | server |
| `PORT` | `server/src/index.ts:21` | optional | `3004` (`ecosystem.config.cjs:10` sets 3004) | public | root, server |
| `HOST` | `server/src/index.ts:25` | optional | `127.0.0.1` (`ecosystem.config.cjs:11` sets the same) | public | — |
| `NODE_ENV` | `server/src/config/load-env.ts:77,120`, `config/sentry.ts:57`, `middleware/error-handler.ts:5` | set by pm2 | — (`ecosystem.config.cjs:9` sets `production`) | public | — |
| `NODE_TEST_CONTEXT` | `server/src/config/load-env.ts:78,120` | do not set | — | public | — |
| `DB_PATH` | `server/src/db/connection.ts:10` | optional | `data/meme-grid.db` under the working directory | public | root |
| `CORS_ORIGINS` | `server/src/app.ts:24-26` | optional | `http://localhost:3005` | public | root, server |
| `GATEWAY_URL` | `server/src/services/gateway.ts:3` | optional | the public Radix mainnet Gateway URL | public | root |
| `APPLICATION_NAME` | `server/src/auth/rola.ts:36`, `config/sentry.ts:97` | optional | `MEME GRID` (rola.ts) | public | server |

`NODE_TEST_CONTEXT` is a marker that Node's test runner sets. It is not a setting. If it is
present without `NODE_ENV=production`, the server skips `.env` and `secrets.env`
(`server/src/config/load-env.ts:57-81`).

### Signing (feature group "signing": vault claims, NFT mints)

| Name | Read at | Required | Default in code | Kind | Listed in |
|---|---|---|---|---|---|
| `BOT_PRIVATE_KEY` | `server/src/services/signer.ts:79,122,150`; group check `config/env.ts:35-38` | group | none | **secret** | server |
| `BOT_KEY_TYPE` | `server/src/services/signer.ts:83` | optional | `secp256k1` | public | server |
| `RADIX_MAINNET_ADDRESS` | `server/src/services/signer.ts:33`; group check `config/env.ts:37,80-82` (mainnet) | group | none | public | server |
| `RADIX_STOKENET_ADDRESS` | `server/src/services/signer.ts:34`; group check `config/env.ts:80-82` (other networks) | group | none | public | server |
| `RADIX_ACCOUNT_ADDRESS` | `server/src/services/signer.ts:33-34` | optional | none. Used only if the network-specific name above is unset. The boot group check does not accept it in place of that name | public | — |

### Wallet sign-in (feature group "ROLA auth")

| Name | Read at | Required | Default in code | Kind | Listed in |
|---|---|---|---|---|---|
| `RADIX_MAINNET_DAPP_DEF` | `server/src/auth/rola.ts:33`; group check `config/env.ts:40-43`; required by both deploy scripts on mainnet (`services/deploy-nfts.ts:40-54`, `services/deploy-meme-token.ts:77-91`) | group | none | public | server |
| `RADIX_STOKENET_DAPP_DEF` | `server/src/auth/rola.ts:34`; deploy scripts off mainnet | group (other networks) | none | public | server |
| `ROLA_ALLOWED_ORIGINS` | `server/src/auth/rola.ts:41` | group | empty | public | server |
| `RADIX_GATEWAY_URL` | `server/src/auth/rola.ts:27-30` | optional | the public Radix mainnet or stokenet Gateway URL, by network | public | server |
| `ROLA_AUTH_MODE` | `server/src/middleware/require-auth.ts:59-63` | optional | `legacy`. Accepted values: `required`, `optional`, `legacy`, `required-for-wallets`. Anything else falls back to `legacy` | public | server |

### NFT minting (feature group "NFT mint worker")

| Name | Read at | Required | Default in code | Kind | Listed in |
|---|---|---|---|---|---|
| `NFT_RESOURCE` | `server/src/services/nft-minter.ts:14`; group check `config/env.ts:48-51` | group | none | public | server |
| `NFT_MINTER_BADGE` | `server/src/services/nft-minter.ts:15`, `services/treasury-guard.ts:38` | group | none | public | server |
| `NFT_ICON_BASE_URL` | `server/src/services/nft-minter.ts:16` | optional | a built-in URL ending in `/nfts` (`nft-minter.ts:16`) | public | — |
| `NFT_MINT_DAILY_CAP` | `server/src/services/mint-cap.ts:34` | optional | unset on mainnet means paused. Unset elsewhere means no cap. `0` or any value that is not a whole number also means paused (`mint-cap.ts:12-19,37-50`) | public | root only |

`NFT_MINT_DAILY_CAP` is read by the server, but only the root example file lists it.

### NFT prize pool

| Name | Read at | Required | Default in code | Kind | Listed in |
|---|---|---|---|---|---|
| `NFT_TREASURY_ACCOUNT` | `server/src/routes/vault.ts:287`, `services/signer.ts:166` | optional | none (the route publishes no address) | public | server |
| `NFT_PRIZE_RESOURCE_ALLOWLIST` | `server/src/services/prize-allowlist.ts:15` | optional | empty (no prizes listed) | public | server |

### Purchase vault (not deployed; see `STATE.md`)

| Name | Read at | Required | Default in code | Kind | Listed in |
|---|---|---|---|---|---|
| `VAULT_COMPONENT` | `server/src/services/tx-verifier.ts:5`, `services/vault-price.ts:122`, `routes/token.ts:26`, `routes/admin.ts:27` | optional | empty / null | public | root, server |
| `MEME_RESOURCE` | `server/src/services/tx-verifier.ts:6`, `routes/token.ts:27`, `routes/admin.ts:28` | optional | empty / null | public | root, server |
| `XRD_RESOURCE_ADDRESS` | `server/src/services/tx-verifier.ts:7-8` | optional | the mainnet XRD resource address | public | — |
| `VAULT_OWNER_COLD_ACCOUNT` | `server/src/services/deploy-meme-token.ts:110` | required by that deploy script on mainnet (`:131-145`) | deployer account off mainnet | public | server |
| `VAULT_OWNER_BACKUP_ACCOUNT` | `server/src/services/deploy-meme-token.ts:111` | same | same | public | server |
| `VAULT_ADMIN_ACCOUNT` | `server/src/services/deploy-meme-token.ts:112` | same | same | public | server |

On mainnet, the vault deploy script refuses to run unless the three custody accounts are
valid, distinct, and none of them is the deployer account (`deploy-meme-token.ts:147-172`).

### Abuse limits, admin and game

| Name | Read at | Required | Default in code | Kind | Listed in |
|---|---|---|---|---|---|
| `GUEST_ID_SECRET` | `server/src/auth/guest-id.ts:71` | optional | if unset or shorter than 16 characters, a key the server creates and keeps in its database (`guest-id.ts:48,72-92`). Changing it invalidates every guest id already issued | **secret** | server |
| `GUEST_MAX_PER_IP_PER_DAY` | `server/src/auth/guest-id.ts:205` | optional | `5`. Must be an integer from 1 to 1000 (`guest-id.ts:191,206-213`) | public | server |
| `ACCOUNT_MAX_NEW_PER_IP_PER_DAY` | `server/src/db/queries/starting-balance-grants.ts:35` | optional | `10`. Must be an integer from 1 to 1000 (`:24,36-44`) | public | server |
| `ADDRESS_CHECKSUM_ENFORCE` | `server/src/auth/address-validation.ts:57` | optional | on. Only `false` turns it off | public | server |
| `ADMIN_TOKEN` | `server/src/middleware/admin-auth.ts:66` | optional | none. If unset, the current token matches nothing (`admin-auth.ts:9-10`) | **secret** | server |
| `ADMIN_TOKEN_PREVIOUS` | `server/src/middleware/admin-auth.ts:67` | optional | none. While set, admin routes accept it alongside `ADMIN_TOKEN`, so a token can be rotated | **secret** | root |
| `ADMIN_TOKEN_EXPIRES_AT` | `server/src/middleware/admin-auth.ts:44-60` | optional | no expiry. Accepts ISO-8601 or Unix seconds. An invalid value makes admin routes answer 500 | public | root |
| `DAILY_SEED_SALT` | `server/src/game/grid.ts:130` | optional | none. Without it, anyone can compute the Daily Challenge seed in advance; the server logs a warning (`grid.ts:133-140`) | **secret** | server |
| `REWARDS_ENABLED` | `server/src/game/rewards.ts:24` | optional | on. Only `false` turns it off | public | server |

### Error reporting (Sentry)

| Name | Read at | Required | Default in code | Kind | Listed in |
|---|---|---|---|---|---|
| `SENTRY_DSN` | `server/src/config/sentry.ts:51` | optional | none (Sentry off) | **secret** (`server/src/config/load-env.ts:25` lists it among the `secrets.env` values) | server |
| `SENTRY_ENVIRONMENT` | `server/src/config/sentry.ts:57` | optional | `NODE_ENV`, then `development` | public | server |
| `SENTRY_RELEASE` | `server/src/config/sentry.ts:58` | optional | the package version (set by npm) | public | server |
| `SENTRY_TRACES_SAMPLE_RATE` | `server/src/config/sentry.ts:59` | optional | `0.1` | public | server |
| `SENTRY_TEST_ON_BOOT` | `server/src/config/sentry.ts:95` | optional | off. `1` sends a test event at boot | public | — |

## Names in the example files that the code does not read

`server/.env.example` names `OWNER_BADGE` and `NFT_COMPONENT`, and a search of non-test code
finds no read of either. The deploy scripts print them as output for the operator to record
(`server/src/services/deploy-meme-token.ts:612`, `server/src/services/deploy-nfts.ts:222`).
`server/src/config/env.ts:45-47` says the mint path does not use `NFT_COMPONENT`.
