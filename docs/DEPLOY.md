# Deploy and rollback

## What has run, and when

| Section | Status |
|---|---|
| 1. Before you start (pre-read, database backup, rollback points) | Run on 2026-11-26, for the deploy of `22dd1dc` |
| 3. Build (server install, tests and build; then frontend install and build) | Run on 2026-11-26 |
| 4. Migrations | No migration was in the 2026-11-26 range, so none applied |
| 5. Restart | Run on 2026-11-26 |
| 6. Verify, and record the deployed commit in `STATE.md` | Run on 2026-11-26 (`STATE.md`, "Deployed build") |
| 7. Rollback | Not yet run. No deploy since the repository became public has needed one |
| 0 and 2. First install on a clean machine (Node, pm2, proxy, env files) | Not yet run from this page. The host was set up before this page existed |

The record of the 2026-11-26 deploy, and of the earlier ones (2026-11-13 and 2026-11-06), is in
[`STATE.md`](../STATE.md).

**Main is ahead of the live site.** At the time of writing, `main` is at `64f1b8d` and the last
recorded deploy is `22dd1dc`. The range includes #43, which made the app's
`Content-Security-Policy` header enforcing instead of report-only. On 2026-11-26 the live site
still sent `Content-Security-Policy-Report-Only`. So the next deploy is the first with the
enforcing CSP: check the header in section 6, and sign in with a wallet in a browser before you
call the deploy done.

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
  was built with as `NEXT_PUBLIC_API_URL` (`src/lib/constants.ts:56-57`). That URL must be on the
  app's own origin (`https://<domain>/api`): the app's enforced CSP allows API calls to its own
  origin only (`connect-src` in `next.config.ts`). The server mounts its
  routes under `/api` (`server/src/app.ts:51`). `CORS_ORIGINS` and `ROLA_ALLOWED_ORIGINS` must
  name the app's public origin (`CONFIG.md`).

## 1. Before you start

- The commit you deploy should be on `main`, and its CI checks should have passed
  (`CONTRIBUTING.md:59-69`). You cannot confirm this from the repository itself. Check it on GitHub.
- List what changed between the running commit and `<commit>` (`git log` and `git diff --stat`
  between them). Look for files under `server/src/db/migrations/` (section 4), for changes to
  `package.json` or `package-lock.json` in either folder (dependency changes; keep the
  `node_modules` copies below), and for changes to `next.config.ts` (response headers).
- Pre-read on `<host>`, read-only, before you change anything:
  - the checkout's `HEAD` is the commit `STATE.md` records as deployed, on `main`, and
    `git status --porcelain` prints nothing;
  - `node --version` is 22 or later, and `NODE_ENV` is unset in your shell (the server tests
    read the operator's env files when it is `production`; `STATE.md`, "Deployed 2026-11-26");
  - both pm2 apps are `online`. Write down their restart counts and process ids, to compare
    after the restart;
  - `GET http://127.0.0.1:3004/api/health` returns `ok: true`. Write down the player and board
    counts;
  - there is enough free disk for a second copy of both `node_modules` folders and `.next`.
- **operator step, not in this repo:** back up the SQLite database (the file at `DB_PATH`,
  default `server/data/meme-grid.db`, `server/src/db/connection.ts:10`) and the current env
  files. This repository has no backup script (`PROVENANCE.md:31-33`). Section 4 explains why
  a database backup is the only way to undo a migration.
- **operator step, not in this repo:** keep copies of the current build output, so that you can
  roll back. `.gitignore:9-13` ignores copies named `.next.bak*/` and `server/dist.bak*/` in
  the checkout root. Those names are the convention this page uses. The step must leave a
  complete copy of `<app-dir>/.next` and `<app-dir>/server/dist` from the running build.
- **operator step, not in this repo:** if the range changes dependencies, also copy
  `<app-dir>/node_modules` and `<app-dir>/server/node_modules`, outside the checkout. Without
  them, a rollback has to reinstall the previous dependencies from the registry.
- Note the commit that is running now. You need it to roll back. A branch at it in the checkout
  on `<host>` (for example `git branch backup/pre-<commit> HEAD`) keeps it reachable after the
  checkout moves.

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

The 2026-11-26 deploy ran the server first, then the frontend.

Server (`server/package.json:6-10`, `README.md:49-50`, `CONTRIBUTING.md:51`):

```bash
cd server
npm ci
npm rebuild better-sqlite3
npm test
npm run build
```

`npm test` unsets `NODE_ENV` itself (`server/package.json:10`). On 2026-11-26 the tests ran on the
host before the build and passed.

Frontend, from the repository root (`package.json:6-9`, `README.md:44-45`, `CONTRIBUTING.md:50`):

```bash
npm ci
npm run build
```

The root `.npmrc` sets `ignore-scripts=true`. It applies to the install in the repository root
only: `server/` has no `.npmrc` of its own, so `npm ci` there runs the install scripts of the
packages in `server/package-lock.json`. `npm rebuild better-sqlite3` makes sure the one native
module the server needs is built (`README.md:55-56`). The server's `build` script also copies the SQL migrations
into `dist/db/migrations/` (`server/package.json:8`). If they are missing, the server refuses to
boot (`server/src/db/migrations/runner.ts:21-30`).

Build before you restart. A comment in CI notes that the deploy depends on this order
(`.github/workflows/ci.yml:52-58`). If the build fails, stop here. The running processes keep
serving the previous build only if you did not replace or remove `.next` or `server/dist` by hand.
Whether `next build` leaves the old `.next` usable after a failed build is unverified.

The running app keeps serving while you build, but root `npm ci` replaces `node_modules` and
`next build` rewrites `.next` underneath it. Expect the site to return errors for a few minutes,
until the restart in section 5. Restart straight after a successful build.

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
    (`server/src/index.ts:54-72`);
  - `[signer] ✓ custody verified — signing as <account>` when a signing key is set
    (`server/src/services/signer.ts:173`);
  - no `FATAL` line, and no `disabled` line you did not expect.
- **Processes:** both pm2 apps are `online`, each restart count is one higher than in the
  pre-read, and the server's start time is later than the new `server/dist/index.js`.
- **Health:** `GET http://127.0.0.1:3004/api/health`, and `<api-url>/health` through the proxy, where
  `<api-url>` is the value of `NEXT_PUBLIC_API_URL`. These return `ok: true` with uptime and player and board counts, or HTTP 500 with
  `ok: false` if the database cannot be read (`server/src/routes/health.ts:7-20`,
  `server/src/app.ts:51`).
- **App:** `https://<domain>/` returns 200. Its response carries an enforcing
  `Content-Security-Policy` header and no `Content-Security-Policy-Report-Only` one
  (`next.config.ts`).
  The live site sent the report-only header until #43 is deployed (see the top of this page).
- **Public API spot checks:** the player and board counts are at least the pre-read's;
  `GET <api-url>/leaderboard` lists no guest id (an id starting `guest_`, `server/src/auth/guest-id.ts:33`); `GET <api-url>/vault/nfts` and
  `GET <api-url>/token/info` report the values in `STATE.md` ("Deployed build"), as long as
  STATE still describes the build you deployed. On 2026-11-26 these were
  `treasury_address: null`, `vault_component: null` and `phase: 1`.
- **Wallet sign-in** in a browser, when the range touches the frontend's sign-in code or the
  response headers.
- **Later read,** a few hours on: both apps still `online`, restart counts unchanged, health
  `ok: true`. On 2026-11-26 this read was taken about three hours after the restart.
- Record the deployed commit and date in `STATE.md` in a follow-up pull request
  (`CONTRIBUTING.md:19-22`).

## 7. Rollback to the previous build

Not yet run (see the top of this page). Use this when the new build fails verification. The
target is the previous recorded commit: the one `STATE.md` names as deployed before this deploy,
which is also the commit you noted in section 1.

There are two ways back. Both end with the checkout on the previous commit.

**A. Redeploy the previous commit.** Slower, and needs only this repository and the registry.

1. **operator step, not in this repo:** check out the previous commit in `<app-dir>` (for
   example `git reset --hard backup/pre-<commit>`, the branch from section 1).
2. Run section 3 (build) again at that commit.
3. Continue at step 3 below.

**B. Restore the copies from section 1.** Faster, and needs those copies.

1. **operator step, not in this repo:** stop or hold both pm2 apps.
2. **operator step, not in this repo:** put back the previous build output. Move the failed
   `<app-dir>/.next` and `<app-dir>/server/dist` aside, and restore the `.next.bak*/` and
   `server/dist.bak*/` copies in their place (`.gitignore:9-13`). If you copied both
   `node_modules` folders, put those back too. Then check out the previous commit, so that the
   checkout matches what runs.

Then, for either way:

3. If the failed build applied a migration (look for `[migration] applied:` in its log) and the
   previous build cannot run against the new schema: **operator step, not in this repo:** restore
   the database backup from section 1. Rows written after the backup are lost.
4. If you changed env values for this deploy, restore the previous env files.
5. **operator step, not in this repo:** start or restart both pm2 apps.
6. Repeat section 6 against the previous commit.
7. Record the rollback in `STATE.md` in a follow-up pull request: which commit runs now, and why.

**What survives a rollback:**

- **The database** keeps every row written since the deploy (players, boards, queued mints,
  submitted transactions), unless you restore the backup in step 3. A restore loses the rows
  written after the backup.
- **Pending transactions.** At boot the server looks for transactions left pending by the
  previous process and checks them again (`server/src/index.ts:44-47`).
- **Env files** are not touched by a code rollback. Step 4 is needed only if you changed them.
- **On-ledger effects** of the failed build (NFTs minted, transactions committed) cannot be
  rolled back.
- **In-memory state** is lost on any restart, rollback or not: for example the rate-limit
  counters (`server/src/middleware/rate-limit.ts:3`).

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
