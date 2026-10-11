# Contributing

## The shape of it

- **`main` is protected. Every change lands as a pull request** — there is no direct push, the
  maintainer included. The four CI checks below are required.
- **Fork, branch, PR.** Branch off `main`, open a pull request back against `main`. CI runs on
  every PR (GitHub may hold an outside contributor's first run until a maintainer approves it);
  a maintainer reviews and squash-merges.
- **One maintainer.** `bigdev` is the sole reviewer and merger today. See
  [`PROVENANCE.md`](./PROVENANCE.md) for who holds the on-chain authority behind that.
- **No review SLA.** This is a solo, self-funded and currently dormant project. A PR may sit
  for a while. That is a signal about one person's calendar, not about the idea.
- **This is the working repository.** The private predecessor this code was exported from is
  kept as an archive that resolves old commit citations (`PROVENANCE.md`); new work lands here.

## The rule that matters most

**A change is real when it is in `main`. [`STATE.md`](./STATE.md) says what is currently true.**
Not a comment in an old issue, not a closed PR's description, not this file if it drifts. If the
README or a design doc contradicts `STATE.md`, `STATE.md` wins, and the contradiction is worth
its own issue.

## Before you open a PR

1. **Read `STATE.md`.** Most of the economy is switched off on purpose. A PR that assumes the
   purchase vault is live, or that rewards pay out on-chain, builds against a state that does not
   exist.
2. **Money-path and custody code gets more scrutiny for being small.** The blueprints under
   `scrypto/` cannot be changed once deployed: a defect there means a redeploy and an orphaned
   resource, which is exactly how the v1 vault was stranded
   ([`docs/VAULT-V1-LOST.md`](docs/VAULT-V1-LOST.md)). Changes to `scrypto/`, to the signer,
   the deploy scripts, the NFT minter or the prize allowlist under `server/src/services/`, or
   to how a transaction manifest is built, should say what they change about a real money path,
   not only which tests they add.
3. **Never move randomness or validation to the client, never mint a guest id client-side, and
   never trust an address by its shape.** `server/src/auth/address-validation.ts` decodes and
   checksums for real, and test fixtures must be genuinely valid addresses
   (`server/src/__tests__/fixtures/addresses.ts`).
4. **Run what you touched** (commands below) before claiming it is safe. CI is the second check,
   not the first.
5. **Scrypto builds on Linux, not macOS.** The ledger simulator compiles to
   `wasm32-unknown-unknown`, and one dependency will not build for that target on a Mac. CI is
   where a blueprint result counts.

## Commands

| Directory | Install | Check |
|---|---|---|
| `/` (the Next.js app) | `npm ci` | `npm run lint && npm run type-check && npm run test:web && npm run build` |
| `server/` | `npm ci && npm rebuild better-sqlite3` | `npx tsc --noEmit && npm test` |
| `scrypto/` | `rustup target add wasm32-unknown-unknown && rustup component add rust-src` | `cargo check --all-targets --locked && cargo test --locked --no-fail-fast` |

Both JavaScript halves are plain npm on Node 22 with committed lockfiles. `.npmrc` sets
`ignore-scripts=true` as supply-chain hardening, which is why the server's one native module
needs the explicit rebuild. The compiler for `scrypto/` is pinned by `scrypto/rust-toolchain.toml`;
the comments there and in `.github/workflows/ci.yml` record why.

## What CI checks

| Check | What it does |
|---|---|
| `Frontend (lint + type-check)` | ESLint, `tsc --noEmit`, the root web tests, a production `next build` |
| `Server (type-check + tests)` | `npm ci`, the better-sqlite3 rebuild, `tsc --noEmit`, the server suite |
| `Scrypto (check + blueprint tests)` | `cargo check`, the wasm build, the ledger tests; publishes the wasm and rpd as run artifacts |
| `gitleaks (secret scan)` | A full-history secret scan on every PR and push, with a pinned, checksum-verified binary |

All four are required on `main`. The workflows are `.github/workflows/ci.yml` and
`.github/workflows/secret-scan.yml`; their comments say why each step is shaped the way it is.

## Reporting a security issue

Do not open a public issue for anything that could move XRD, mint or duplicate an NFT, forge a
wallet proof or bias a roll. See [`SECURITY.md`](./SECURITY.md) for the private route. Everything
else — UI bugs, unclear docs, feature requests — is a normal public issue.

## What review looks like

Claims cite something checkable: a line in a source file, a test, a transaction id, a Gateway
read. A PR that says "this fixes X" without saying how X was confirmed will be asked for that
first. The maintainer holds their own changes to the same bar, and the repository's own
documents say so where they fall short of it — the provenance section of
`docs/GAME-DESIGN-REVIEW.md` is an example.
