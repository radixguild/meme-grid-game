# Security policy

This repository is a Web3 dice game with real money paths: Scrypto blueprints that
custody XRD and mint achievement NFTs on Radix **mainnet** (see `README.md` and
`docs/VAULT-V1-LOST.md` for the project's own account of what happens when one of
those paths goes wrong). That means a security finding here can mean real funds or
real on-chain assets are at risk, and this file says what to do when you find one.

## What counts as a finding here

Anything that could let someone move XRD out of a vault they don't own, mint or
duplicate an achievement NFT without satisfying its unlock condition, manipulate the
server-authoritative dice roll or scoring in their favor, forge or replay a
wallet-ownership proof, or otherwise bypass the game's economic or custody rules —
in the Scrypto blueprints under `scrypto/`, the Express API under `server/`, or the
Next.js frontend under `src/`.

## Reporting a security issue

**Do not open a public GitHub issue.** Report it privately instead, using GitHub's
"Report a vulnerability" flow on this repository's Security tab (Security →
Advisories → Report a vulnerability), so the report and any discussion stay private
until a fix ships. Include what you found, the affected file(s) or blueprint
method, and, if you have one, a reproduction (a testnet/simulator repro is strongly
preferred over anything demonstrated against mainnet).

If you are not sure whether something rises to this level, report it privately
anyway — coordinated disclosure costs nothing if the finding turns out to be
benign, and the reverse mistake (a live-mainnet exploit discussed in public before
it's fixed) is not recoverable.

We will acknowledge a report, work a fix, and coordinate on when it's safe to
discuss publicly. There is no funded bug-bounty program; reports are still welcome
and handled the same way regardless of whether a reward is on offer.

## What is out of scope for private disclosure

General usage questions, feature requests, and non-security bugs (a UI glitch, a
level-up threshold that reads wrong, a typo) are fine as public issues. So is
anything already documented as a known, accepted limitation in `README.md` or
`docs/` — for example the v1 purchase vault's stranded admin badge
(`docs/VAULT-V1-LOST.md`): that account is already public and the vault's custody problem
is already documented, so it is a documented fact, not a new disclosure.

## Scope reminder

Radix mainnet was halted from 2026-08-31 and resumed 2026-09-11; chain-touching
paths (NFT minting, any future vault redeploy) are not paused on it. How you
report a finding does not depend on that — report it the same way, whether or
not the affected path is currently live.
