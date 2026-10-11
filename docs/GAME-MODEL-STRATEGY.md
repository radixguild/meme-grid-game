# MEME GRID — Engagement Strategy

Generated 2026-07-18 from a multi-lens strategy pass (guild-operator incentives,
core-loop depth, economy, social/viral, Radix-native value), each idea
adversarially vetted against the guild-separation constraint and grounded in the
actual code. This is the product direction; the security and wallet work is tracked
separately (see [`STATE.md`](../STATE.md) for what is live and what is disclosed).

## 1. What the game IS

MEME GRID is a server-authoritative, on-chain-asset engagement engine: start a
board (free since #28), roll a weighted d6 ~95 times to complete an 8x8 grid
(bounded 64-128 by the sum of the cell thresholds — the old "~100-150" overstated
the top end; 150 is not reachable), and convert
rare moments (purple-otter squares, moon cells, BLACKOUTs) into XP, real mainnet
achievement NFTs, and MEME. The progression spine — 10 levels, 23 NFTs across 6
rarities, streaks, combos, power-ups — is already built and mostly **idle capital
waiting to be pointed at a purpose**. Most of the highest-value work is plumbing
what exists, not new systems.

It serves guild operators through a **clean, one-directional read-only
interface**: the game *reads* a signed guild activity feed (votes, bounties,
reviews) keyed to a ROLA-verified wallet and rewards it with game-side credits and
NFTs minted off the game's OWN resource — it never imports a guild key, badge,
signer, or dApp def. Recognition flows guild→game as data; assets flow only from
the game's own treasury.

## 2. Guild-operator engagement (the founding purpose)

- **Operator Recognition NFTs — a 7th tier.** Extend the 23-NFT catalog with
  Governance Voter / Bounty Steward / Ops Veteran; unlock condition reads the
  signed guild feed, the live minter mints off the game's own resource to the
  operator's own wallet. Pure catalog+minter reuse; only the condition source is new.
- **Operator status flag → always-on perks.** A ROLA wallet confirmed as a
  current operator sets a re-verified `is_operator` flag: daily power-up drop,
  leaderboard/gallery operator frame, otter-cell skin, bonus raffle tickets, and a
  *capped* weekly MEME bonus. Caps protect the economy if the feed is compromised.
- **Operator Contribution Leaderboard — a 4th `ops` sort.** `leaderboard.ts`
  already dispatches on `?sort`; add `ops` ranking operators by votes+bounties+
  reviews ingested from the feed and cached in the game's SQLite. Lowest-effort win.
- **Operator Quest Board (repurpose the dead Daily Challenge page).** Render the
  operator's open guild items as in-game quests ("Vote on active proposal",
  "Complete a bounty this epoch"); completion verified by server re-poll, paid via
  the existing rewards/streaks pipeline. Strongest work→play bridge, higher effort.

## 3. Phased roadmap

### NOW — fits standalone / Phase-1, no wallet separation needed (high leverage)
- **Make the Daily Challenge real** (v5/e2): wire the already-computed seed into
  `generateGrid`/`pickCellType`/`rollDice`, add a `daily` leaderboard query.
  Flagship, mostly plumbing.
- **NFT in-game utility** (v5/e3): small non-stacking, skill-gated perks granted
  off the game's own achievement DB — no wallet round-trip, no pay-to-win.
- **Operator Contribution Leaderboard `ops` sort** (v4/e2): cheapest operator win.
- **Big-Drop Share Cards** (v5/e3): branded OG image on otter/moon/BLACKOUT/mint
  moments next to the confetti; one-tap Share to X/TG. Near-zero-cost acquisition.
- **On-chain NFT flex profile** (v4/e2): extend the redesigned gallery into a
  public shareable page with rarity percentiles from existing stat counters.
- **Commit-reveal provably-fair rolls** (v5/e3): replace `Math.random()` so players
  can recompute every roll. Biggest trust unlock for a Web3 dice game.

### NEXT — after wallet separation + the treasury is the game's OWN account
- **Operator Recognition NFTs (7th tier)** (v5/e3) · **Operator status flag →
  capped perks + MEME bonus** (v5/e3) · **Otter-square raffle, on-chain
  provably-fair draw** (v5/e4, GATED on the signer no longer holding guild badges) ·
  **Referral onboarding** (v4/e3, server-side rewards) · **Skill-normalized ladder +
  seasonal soft-reset** (v4/e3, land before XRD→MEME buy) · **Durable MEME sinks**
  (v4/e3, cosmetic skins / loadout slot / prestige burn).

### LATER — bigger design bets
- **Aimed "Focus" rolls** (v4/e3) · **Ride-or-Rug push-your-luck banking** (v4/e3) ·
  **Cell Mastery + Prestige** (v4/e3) · **Operator Quest Board** (v5/e4) ·
  **Expeditions roguelite** (v5/e4) · **Cross-dApp holder quests** (v4/e4) ·
  **Guild-vs-Guild squad ladder** (v3/e4, self-declared tag = zero-integration v1).

## 4. Watch-outs

- **Free-play integrity before the XRD peg.** ⚠️ **Stale as of 2026-08-23 (#28).**
  This said the faucet was "generous (500 free MEME/guest)". The free grant is now
  **15 ROLLS, once** (`FREE_STARTING_BALANCE`, server/src/game/economy.ts) — about
  16% of one board — streaks pay 0 ROLLS at every tier, and lucky drops settle only
  on a completed board. The remaining free faucet is the level-up bonus (2,725
  ROLLS across levels 2-10), which a trial cannot reach. The rest of this watch-out
  still stands: do NOT enable the XRD→ROLLS buy until the ladder
  ranks on score-per-roll efficiency, raffle tickets come from otter squares (not
  MEME spend, weekly-capped), and durable non-power sinks exist — otherwise a
  spender buys the leaderboard and the raffle.
- **Separation is a hard gate, not a preference.** Every operator/raffle idea
  assumes read-only HTTPS/JSON from a signed, genuinely public guild feed; all
  assets minted/sent from the game's OWN mainnet signer and resources; caps +
  rate-limits so a compromised guild API can't drain MEME/tickets. The raffle and
  operator-NFT tiers are BLOCKED until the standing signer no longer holds guild
  badges — verify custody by key derivation before publishing any treasury address.
- **Page contention + scope.** The Daily Challenge page is the natural home for
  both the seeded board (NOW) and the Operator Quest Board (LATER) — decide early
  which owns the route and give the other a tab. Resist Expeditions/roguelite depth
  before the NOW-tier trust and share loops are live.

---

## Prioritised backlog (best-first, from the strategy pass)

Value/Effort are 1-5 (higher effort = more build). Ops = serves guild operators.

| # | Idea | Ops | V | E | Leverage |
|---|------|-----|---|---|----------|
| 1 | Make the Daily Challenge real (seeded shared board + daily/weekly ladder) | | 5 | 2 | high |
| 2 | Real in-game utility for the 23 NFTs (earned skill-gated perks, not bought) | | 5 | 3 | high |
| 3 | Operator Recognition NFTs — a 7th "operator" tier | ✓ | 5 | 3 | high |
| 4 | Operator status flag → always-on perks + capped MEME/ticket bonuses | ✓ | 5 | 3 | high |
| 5 | Operator Contribution Leaderboard — a 4th `ops` sort | ✓ | 4 | 2 | high |
| 6 | Big-Drop Share Cards (otter/moon/BLACKOUT flex → X/TG) | | 5 | 3 | high |
| 7 | Commit-reveal provably-fair rolls | | 5 | 3 | high |
| 8 | On-chain NFT flex profile with scarcity ranking | | 4 | 2 | high |
| 9 | Operator Quest Board (real guild items as in-game quests) | ✓ | 5 | 4 | medium |
| 10 | Aimed "Focus" rolls — a targeting economy | | 4 | 3 | medium |
| 11 | Ride-or-Rug — push-your-luck banking on rug_pull | | 4 | 3 | medium |
| 12 | Cell Mastery + Prestige — meta-progression past the XP ceiling | | 4 | 3 | medium |
| 13 | Referral onboarding with server-side rewards | | 4 | 3 | medium |
| 14 | Durable MEME sinks (cosmetic skins, loadout slot, prestige burn) | | 4 | 3 | medium |
| 15 | Skill-normalized ladder + seasonal soft-reset (free-play integrity) | | 4 | 3 | medium |
| 16 | Otter-square raffle with on-chain provably-fair draw (GATED on separation) | | 5 | 4 | medium |
| 17 | Expeditions — run-based roguelite chaining 3-5 boards with drafts | | 5 | 4 | medium |
| 18 | Live spectator drama ticker (near-BLACKOUT alerts via MemeTicker) | | 3 | 2 | medium |
| 19 | Guild-vs-Guild squad leaderboard (read-only / self-declared tag) | ✓ | 3 | 4 | low |
| 20 | Cross-dApp holder quests — partner-asset boards via Gateway read | | 4 | 4 | low |

Full per-idea detail (with separation notes) is in the workflow journal; the
summaries above are lossy. Key separation notes: #3/#4/#9 read a signed public
guild feed and mint/pay from the game's own resources only; #16 is blocked until
the signer no longer holds guild badges; #13/#17 route any on-chain prize through
the future dedicated raffle treasury, never the guild-badge key.

### Cut / merged
- **Board tiers (Blitz 5x5 / Whale 10x10)** — needs refactoring the hardcoded
  `GRID_SIZE`; session-length variety is better delivered by Expeditions + daily
  mutators.
- **Guild-Epoch Seasons prize pool** — subsumed by operator rewards + seasonal
  soft-reset; fold epoch timing in as an option instead of a new read-coupling.
- **On-chain weekly tournament with MEME buy-in** — double-gated (needs XRD buy
  live AND treasury de-risk) and redundant with the seeded weekly ladder + raffle.
- Duplicates merged: three "Daily Challenge" variants → #1; NFT utility variants →
  #2; operator-NFT variants → #3; operator perks/rewards → #4; otter-raffle → #16.
