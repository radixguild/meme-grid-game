Draft from the repository contents; not yet run end to end from a clean machine.

# Deploy and rollback

This page covers deploying the game's two processes, the Next.js app and the Express API, from
this repository, and rolling back to the previous build. It uses only what this repository
contains. Some steps depend on the operator's own machine and tooling, which this repository
does not include (`PROVENANCE.md:31-33`). Those steps are marked
**"operator step, not in this repo"**, with what the step must achieve.

Placeholders: `<host>` is the machine, `<app-dir>` is the checkout of this repository on it,
`<domain>` is the public site name, `<api-url>` is the public API base URL (the
`NEXT_PUBLIC_API_URL` value), and `<commit>` is the commit you mean to deploy.

Read [`STATE.md`](../STATE.md) first. It says what is switched off. This page does not change
any of that.

## 0. What runs

`ecosystem.config.cjs` is a pm2 config that defines two apps:

| pm2 app | Working dir | Runs | Listens on |
|---|---|---|---|
| `meme-grid-server` | `<app-dir>/server` | `dist/index.js` with `NODE_ENV=production` (`ecosystem.config.cjs:3-19`) | `127.0.0.1:3004` (`:10-11`, `server/src/index.ts:21-25`) |
| `meme-grid-app` | `<app-dir>` | `node_modules/.bin/next start -H 127.0.0.1 -p 3005` (`ecosystem.config.cjs:20-32`) | `127.0.0.1:3005` |

Both listen on localhost only. A reverse proxy in front of them terminates TLS, and the server
trusts one proxy hop (`server/src/app.ts:32-35`).

- **operator step, not in this repo:** install Node 22 (the version CI uses, `.github/workflows/ci.yml:41,324`)
  and pm2 on `<host>`.
- **operator step, not in this repo:** configure the reverse proxy for `<domain>`. It must serve
  the app from `127.0.0.1:3005`, and serve the API from `127.0.0.1:3004` at the URL the frontend
  was built with as `NEXT_PUBLIC_API_URL` (`src/lib/constants.ts:56-57`). The server mounts its
  routes under `/api` (`server/src/app.ts:51`). `CORS_ORIGINS` and `ROLA_ALLOWED_ORIGINS` must
  name the app's public origin (`CONFIG.md`).

## 1. Before you start

- The commit you deploy should be on `main`, and its CI checks should have passed
  (`CONTRIBUTING.md:59-69`). You cannot confirm this from the repository itself. Check it on GitHub.
- **operator step, not in this repo:** back up the SQLite database (the file at `DB_PATH`,
  default `server/data/meme-grid.db`, `server/src/db/connection.ts:10`) and the current env
  files. This repository has no backup script (`PROVENANCE.md:31-33`). Section 4 explains why
  a database backup is the only way to undo a migration.
- **operator step, not in this repo:** keep copies of the current build output, so that you can
  roll back. `.gitignore:9-13` ignores copies named `.next.bak*/` and `server/dist.bak*/` in
  the checkout root. Those names are the convention this page uses. The step must leave a
  complete copy of `<app-dir>/.next` and `<app-dir>/server/dist` from the running build.
- Note the commit that is running now. You need it to roll back.

## 2. Configuration

All names, where each one is read, and which ones are secret are listed in
[`CONFIG.md`](./CONFIG.md).

- **Frontend:** the `NEXT_PUBLIC_*` values must be in place **before** `npm run build`, because
  Next.js inlines them into the bundle (`src/lib/gift/index.ts:48-55`). The README's local setup
  uses `.env.local` in `<app-dir>` (`README.md:44`).
- **Server:** non-secret values go in `<app-dir>/server/.env` and secrets go in
  `<app-dir>/server/secrets.env` with mode 0600 (`server/src/config/load-env.ts:19-38,101-108`;
  `ecosystem.config.cjs:13-15`). `RADIX_NETWORK` is the only value the server needs to boot
  (`server/src/config/env.ts:31-33`). Signing, wallet sign-in and NFT minting each switch off,
  with a log line, when their group of values is incomplete (`server/src/config/env.ts:35-51,126-132`).
- `NFT_MINT_DAILY_CAP` unset on mainnet means mints are paused (`server/src/services/mint-cap.ts:12-19`).
  Set it on purpose.
- **operator step, not in this repo:** write the env files on `<host>`. `CONFIG.md` lists every name
  the code reads.

## 3. Build

Run these from `<app-dir>`, checked out at `<commit>`.

- **operator step, not in this repo:** update `<app-dir>` to `<commit>`. `STATE.md:60-63`
  records that the deploy directory became a checkout of this public repository on 2026-11-06.

Frontend, from the repository root (`package.json:6-9`, `README.md:44-45`, `CONTRIBUTING.md:50`):

```bash
npm ci
npm run build
```

Server (`server/package.json:6-9`, `README.md:49-50`, `CONTRIBUTING.md:51`):

```bash
cd server
npm ci
npm rebuild better-sqlite3
npm run build
```

`.npmrc` sets `ignore-scripts=true`, so `npm rebuild better-sqlite3` builds the one native module
the server needs (`README.md:55-56`). The server's `build` script also copies the SQL migrations
into `dist/db/migrations/` (`server/package.json:8`). If they are missing, the server refuses to
boot (`server/src/db/migrations/runner.ts:21-30`).

Build before you restart. A comment in CI notes that the deploy depends on this order
(`.github/workflows/ci.yml:52-58`). If the build fails, stop here. The running processes keep
serving the previous build only if you did not replace or remove `.next` or `server/dist` by hand.
Whether `next build` leaves the old `.next` usable after a failed build is unverified.

## 4. Migrations

The server applies the SQL migrations itself at boot, before it accepts traffic
(`server/src/index.ts:27-29`). The migration files are `server/src/db/migrations/*.sql`. The
server applies each file not yet recorded in the `_migrations` table, in filename order, and runs
each one in a transaction. A file that fails is rolled back, and the server exits with the
file's name (`server/src/db/migrations/runner.ts:32-73`). There is no separate migration command.

The repository has **no down-migrations**. Rolling back the code does not roll back the schema.
Whether the previous build runs against a newer schema has to be checked for each migration
(unverified in general). To undo a migration, restore the database backup from section 1.

## 5. Start or restart

- **operator step, not in this repo:** start or restart the two pm2 apps defined in
  `ecosystem.config.cjs` (`meme-grid-server` and `meme-grid-app`) so they pick up the new
  build and env. A restart must also reload the env files.

Before it listens, the server checks that the signing key controls the configured account,
and exits if it does not. The check is skipped when no key or no account is set
(`server/src/index.ts:39-42`, `server/src/services/signer.ts:150`).

## 6. Verify

On `<host>`:

- **Server log** (pm2 log for `meme-grid-server`):
  - `[config] ✓ all env groups present`, or a `[config] ⚠ … disabled — missing: …` line for each
    group you left off on purpose (`server/src/config/env.ts:126-136`);
  - `[migration] applied: <file>` for each new migration (`server/src/db/migrations/runner.ts:72`);
  - `[meme-grid-server] listening on 127.0.0.1:3004` (`server/src/index.ts:49-50`);
  - `[nft-mint-worker] started (30s interval; <cap>)`, where `<cap>` matches the
    `NFT_MINT_DAILY_CAP` you meant to set, or `[nft-mint-worker] skipped …` if minting is off
    (`server/src/index.ts:54-72`).
- **Health:** `GET http://127.0.0.1:3004/api/health`, and `<api-url>/health` through the proxy, where
  `<api-url>` is the value of `NEXT_PUBLIC_API_URL`. These return `ok: true` with uptime and player and board counts, or HTTP 500 with
  `ok: false` if the database cannot be read (`server/src/routes/health.ts:7-20`,
  `server/src/app.ts:51`).
- **App:** `https://<domain>/` returns 200. Its response carries an enforcing
  `Content-Security-Policy` header and no `Content-Security-Policy-Report-Only` one
  (`next.config.ts`).
- **Public API spot check:** `GET <api-url>/token/info` reports the values in
  `STATE.md:77-80`, as long as STATE still describes the build you deployed.
- Record the deployed commit and date in `STATE.md` in a follow-up pull request
  (`CONTRIBUTING.md:19-22`).

## 7. Rollback to the previous build

Use this when the new build fails verification. It needs the copies from section 1.

1. **operator step, not in this repo:** stop or hold both pm2 apps.
2. **operator step, not in this repo:** put back the previous build output. Move the failed
   `<app-dir>/.next` and `<app-dir>/server/dist` aside, and restore the `.next.bak*/` and
   `server/dist.bak*/` copies in their place (`.gitignore:9-13`). Alternatively, check out the
   previous commit and repeat section 3.
3. If the failed build applied a migration (look for `[migration] applied:` in its log) and the
   previous build cannot run against the new schema: **operator step, not in this repo:** restore
   the database backup from section 1. Rows written after the backup are lost.
4. If you changed env values for this deploy, restore the previous env files.
5. **operator step, not in this repo:** start both pm2 apps again.
6. Repeat section 6 against the previous commit.

## 8. Pause NFT mints without a code change

Set `NFT_MINT_DAILY_CAP=0` in the server env and restart `meme-grid-server`. The worker then
submits no mint transactions, and queued mints stay queued (`server/src/services/mint-cap.ts:1-19`).
The cap is read on every call (`mint-cap.ts:21`), but values from env files load only at process
start (`server/src/config/load-env.ts:116-124`).

## Not covered here

- **On-chain deploys.** The blueprint deploy scripts are `server/src/services/deploy-nfts.ts` and
  `server/src/services/deploy-meme-token.ts`. Their headers give usage and prerequisites
  (`deploy-nfts.ts:1-13`, `deploy-meme-token.ts:1-45`). They need built wasm and rpd files; the
  vault script's header says they must be built on Linux.
  `CONTRIBUTING.md:71-84` explains how to fetch and verify that build from CI. Per
  `STATE.md:114-119`, the v2 vault is not deployed. These scripts are not part of an app deploy.
- **Reverse proxy, TLS, firewall, process start at boot, log rotation, backups:** operator tooling,
  not in this repository.
