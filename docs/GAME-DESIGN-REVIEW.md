# Game & Tokenomics Design Review — 2026-08-21

> **A dated snapshot, written 2026-08-21 and not maintained since. [`STATE.md`](../STATE.md) wins
> wherever the two differ.** File and line references are as of that date and have since moved.
> Statements that have been overtaken are marked **Superseded** where they appear (§1.3, §5, §7,
> §8, §10), with what is true now; items re-checked and still open are marked **Still open**
> (§1.2, §4). All of those were checked against the code on 2026-10-11; nothing else was re-checked.
> Section numbers are kept stable because code comments and `STATE.md` cite them.

**Purpose: settle what the game should be *before* v2 mints new assets.** A redeploy orphans
resources — that is what went wrong with v1 (`VAULT-V1-LOST.md`), and it is why this review ran
ahead of the deploy rather than after it.

**Headline: nothing in this review requires a change to the v2 vault blueprint.** `buy_rolls`,
`burn_rolls` and `withdraw_xrd` are scoped to purchase XRD, and no proposal here touches them. The
deploy is gated on badge custody and on the standing purchase gate below — not on this document.

## How to read the confidence levels

| Marker | Means |
|---|---|
| **Verified** | Read in the code at a cited line, or demonstrated by running something |
| **Estimated** | Derived analytically from tables in the code; no production data was queried |
| **Open** | A decision, not a finding |

No query was run against a live database for this review. Every "average" below is computed from
the weight tables, and real figures may run 10–20% higher.

---

## 1. Bugs

### 1.1 Pattern bonuses paid on every roll — FIXED

**Verified, and fixed this session.** `checkPatterns(grid)` evaluated the whole board and returned
everything currently true, with no memory of what it had already paid. The engine paid all of it on
every cell completion. Once the four corners were done, "Four Corners!" re-fired for the rest of
the board.

Measured on a grid with the corners pre-completed:

```
12 rolls → "Four Corners!" awarded 12 more times → +360 pts, +480 XP
```

Corners is the cheapest of five. Border (100/120), centre (60/80) and X-pattern (80/100) stack on
top. It also inflated the **currency faucet** — XP drives levels, levels pay ROLLS — and
`powerups.ts` re-triggered it for `x_ray`, `magnet` and `swap`, none of which complete a cell, so it
was farmable at zero ROLLS cost.

Fixed by scoping `checkPatterns` to the just-completed cell, the idiom `checkNewLines` has always
used. Same repro after the fix: **0 re-awards**. Three regression tests added.

> **Consequence for everything below: all existing score and XP telemetry is inflated by this bug.**
> Do not calibrate any tuning decision against historical numbers.

### 1.2 Row bomb completes cells without counting rolls — OPEN

**Verified.** `board.rolls_used` is incremented at `routes/game.ts:160` (roll),
`routes/game.ts:284` (wild) and `routes/powerups.ts:141` (reroll). The **row_bomb branch increments
nothing**, while `executeRowBomb` completes up to 8 cells.

This is not urgent today — nothing consumes `rolls_used` yet. It becomes **mandatory** the moment
either of these ships:

- the **efficiency ladder** (§4), whose denominator it corrupts
- the **speed_runner** NFT ("board in under 80 rolls"), which it makes purchasable

Deliberately not fixed here, because the right fix depends on which metric §4 adopts, and changing
`rolls_used` now would silently alter the meaning of every board record already stored.

> **Still open (checked 2026-10-11).** The `row_bomb` branch of `server/src/routes/powerups.ts`
> still does not touch `rolls_used`; the roll and wild-card routes and the re-roll branch still do.

### 1.3 The dice are decorative — OPEN, and it is a design question

**Verified.** `engine.ts:79` does `cell.hits += 1` regardless of `dice.value`. A roll of **1 —
labelled "Miss", 30% of all rolls** — advances the cell exactly like a 6. The die's only real effect
is `bonusXp`.

The player is shown "Dice: Miss (1)" while the miss silently does not happen. The per-roll "weighted
d6" is presentation; the only randomness that matters is an invisible cell pick.

This is not a bug — it is a choice that is now visible. Changing it changes how every single roll
feels, so it is a design decision, not a fix.

> **Superseded in part (checked 2026-10-11).** A roll of 1 is no longer labelled "Miss":
> `server/src/game/dice.ts` now labels it "No bonus", because the old label described something that
> did not happen. The die is otherwise unchanged. `engine.ts` still advances the cell on every roll
> whatever the value, so this stays open as a design question.

---

## 2. The structural payout problem

**Verified.** Completing a board means completing all 64 cells, so finishing necessarily fires every
row (8), column (8), both diagonals, and all five patterns — **exactly once, by construction**.

| Source | Score | XP |
|---|---|---|
| Lines (8 rows + 8 cols + 2 diagonals) | 500 | 600 |
| Patterns (corners, border, centre, X, blackout) | 770 | 1,340 |
| **Guaranteed floor per completed board** | **1,270** | **1,940** |

Its only legitimate variance is how many lines complete *simultaneously* on one roll — itself a
function of random fill order, not skill.

So a large, near-constant share of every board's score measures **"did you finish"**, not "how well
did you play". Combined with leaderboard sorts that are all monotonic in rolls played
(`leaderboard.ts:56-73`), this is the concrete form of the gap that the "Free-play integrity before
the XRD peg" watch-out in `GAME-MODEL-STRATEGY.md` (§4) already names. It is why §4 subtracts the
floor rather than ranking on raw score.

---

## 3. The 10 unreachable NFTs

**Verified**, and already pinned by `nft-obtainability.test.ts` (13 obtainable, 10 not). Two root
causes:

**Missing stat (6)** — the condition is a threshold on a field that is never computed:

| NFT | Condition | Fix |
|---|---|---|
| `rug_survivor` | 10 rug pulls hit | `COUNT(*) FROM rolls WHERE cell_type='rug_pull' AND completed=1` |
| `extra_master` | 20 extra turns | same shape, `cell_type='extra_turn'` |
| `wild_user` | 10 wild cards used | `COUNT(*) WHERE special_effect='wild_free_roll'` — the *use* event, not the cell |
| `diamond_collector` | 10 diamonds | same shape, `cell_type='diamond'` |
| `moon_shot` | 1 moon | same shape, `cell_type='moon'` — cheapest of all, single hit |
| `streak_7` | 7-day streak | **already exists** as `players.streak_current`; pure wiring |

All six need **zero migration** — `rolls` already logs `cell_type` and `completed`.

**No dispatcher (4)** — `parseThresholdCondition` returns null for every `special:` condition, and
no `special:` branch exists anywhere:

- **`no_rug`** and **`perfect_board`** are near-duplicates of each other at different rarities, and
  both are **pay-to-win as specified**: targeting is uniform-random and finishing means every cell
  is eventually hit, so completing a board having hit none of its ~6 rug-pull cells requires buying
  `swap` on each one before RNG reaches it. **Recommend cutting one and redefining the other.**
- **`speed_runner`** is cleanly derivable from `board.rolls_used` — *after* §1.2 is fixed.
- **`full_collection`** is circularly blocked on the other nine, so it is necessarily last.

---

## 4. The efficiency ladder

This is the highest-value item because **purchases are gated on it**:
`GAME-MODEL-STRATEGY.md` §4 (Watch-outs) — *"do NOT enable the XRD→ROLLS buy until the ladder
ranks on score-per-roll efficiency…"*

**Naive score-per-roll is the wrong metric, and would be purchasable on day one.** Two reasons:

1. Score is dominated by the structural floor (§2), which measures finishing, not skill.
2. **The denominator is buyable.** Row bomb (§1.2) raises the numerator *and* leaves the denominator
   untouched, so ROLLS spend directly inflates the ratio.

**Proposed metric — Net Bonus per Attempt:**

```sql
SELECT radix_address,
       COUNT(*) AS boards_n,
       (SUM(score) - COUNT(*) * :structural_floor)
         / (SUM(rolls_used) + :shrinkage_k) AS net_bonus_per_attempt
FROM boards
WHERE status = 'completed'
  AND radix_address NOT LIKE 'guest_%'
GROUP BY radix_address
HAVING COUNT(*) >= 10
ORDER BY net_bonus_per_attempt DESC;
```

- `:structural_floor` is **computed in code** from the cell and pattern tables, never a magic
  number, so it self-updates if balance changes.
- `:shrinkage_k` is an additive prior (~500 roll-equivalents) that pulls small samples toward zero,
  so ten lucky boards cannot outrank two hundred steady ones.
- **Guests must be excluded.** The minimum-sample rule stops one lucky *board* from ranking; it does
  not stop re-rolling disposable *identities* until one gets a lucky draw (§5).
- No migration for phase 1. `score`, `rolls_used` and `status` already exist.

Honest framing: with uniform-random targeting, this is closer to *luck normalised by cost* than to
skill. It satisfies the gate's actual requirement — not purchasable — which is the property that
matters. Real skill expression needs the engine to give players more agency first.

> **Still open (checked 2026-10-11).** The ladder is not built: `leaderboard.ts` still ranks only by
> XP, best score or boards completed, and the XRD → ROLLS purchase stays switched off (`STATE.md`).

---

## 5. The free-ROLLS faucet was open — SUPERSEDED

> **Superseded: the hole this section describes is closed (checked against the code on
> 2026-10-11).** Guest ids are no longer minted in the browser. The server issues them at
> `POST /api/guest/new`, HMAC-signed, and counts issuance per IP (default 5 per rolling day,
> `GUEST_MAX_PER_IP_PER_DAY`). `validateAddress` rejects any `guest_…` id the server did not sign,
> apart from legacy ids that already name a player. The starting grant is **15 ROLLS**
> (`FREE_STARTING_BALANCE`), not the 500 described below. First-time funding of a wallet address
> needs a proven session and is capped per IP per day (`ACCOUNT_MAX_NEW_PER_IP_PER_DAY`, default
> 10). What remains is recorded in `STATE.md`: the faucet is **mitigated, not closed**, because a
> real keypair with a real signing flow is bounded only by that cap. The analysis below is kept as
> the record of why the fix has this shape.

**As found on 2026-08-21: verified, structural — no evidence it had been exploited.**

`getGuestId()` minted `"guest_" + Math.random().toString(36)` into **sessionStorage, client-side,
with no server registration**. `validateAddress` accepted anything matching `guest_[a-z0-9]{8,32}`.
`creditStartingBalanceOnce` gated only on the address, so a fresh guest ID always collected the full
**500 ROLLS**.

A cleared tab was a new account. The only backstop was per-IP rate limiting (120 GET/min), which
bounded throughput but not the hole.

**The fix proposed here was built:** guest IDs issued server-side (`POST /api/guest/new`,
HMAC-signed so a self-minted string fails validation), plus a per-IP guest-creation quota. It
touches neither ROLA nor wallets, so guest play keeps working.

The daily streak was **not** the exposure — a fresh guest only ever collected the day-1 tier, and
the large payouts needed real consecutive calendar days. (Daily check-ins now pay no ROLLS at any
streak tier, only XP and power-ups.)

---

## 6. Prizes and the raffle

**Design direction (2026-07-26):** a ticket-based weekly draw, a generous guarantee, and donations
staying open as gifts. None of it is built — `STATE.md` records that no raffle, draw or on-chain
payout path exists in the code.

**Where tickets come from.** Tickets come from **otter squares, weekly-capped, deliberately not
per-board** (`GAME-MODEL-STRATEGY.md` §4, and the comment in `src/app/tokenomics/page.tsx`) —
because per-board is near-linear in ROLLS spend, so it lets a payer buy entries. A
one-ticket-per-completed-board design was considered and rejected for that reason, and should not
be rebuilt.

**A commit-reveal prize contract was considered and rejected.** It is not part of the direction
above, and it adds a permanently-live contract and a new custody surface before the separation of
the game's signer from the Guild's badges (`GAME-MODEL-STRATEGY.md` §4) is resolved. The same "who
was entered, was it rigged" property comes from publishing the ticket list, the randomness source
and the selection formula. No new Scrypto surface required.

**An NFT-holder bonus to ticket caps was also rejected**, and the reasoning generalises: holding
achievement NFTs is a proxy for cumulative rolls played, which becomes cumulative *spend* once
buying reopens. It would look fair and smuggle spend back in through the side door.

**The otter has no unique verb.** It is weight 5/105 with a flat +15/+30 — *less* rewarding than
diamond (30/50) or moon (50/100) — plus client-side confetti. Nothing anywhere counts otter
completions. If it is the signature mechanic and the ticket source, it needs to *do* something.

---

## 7. Level pacing — Estimated

Average XP per completed board ≈ **4,440** (analytical floor; real value likely 4,400–5,500).

| Milestone | Cumulative boards |
|---|---|
| L2 | 0.45 |
| L3 | 1.35 |
| L5 | 6.76 |
| L8 | 31.5 |
| L10 | **67.6** |

**The front is trivial and the tail is a wall.** A new player levels up **twice before finishing
their second board** — collecting 75 ROLLS of level-up bonus on top of the free 500 — while L9→L10
alone is ~20 boards, roughly 30% of the entire journey in one step. The middle (L4–L8) is
well-paced.

Achievement XP is a rounding error against this: all 13 obtainable NFTs together give 6,450 XP,
**under 2.2%** of the 300,000 needed for L10.

> **Superseded in part (checked 2026-10-11).** The free starting grant is now **15 ROLLS**, not
> 500 (`FREE_STARTING_BALANCE`). The 75 ROLLS of level-up bonus for levels 2 and 3 (25 + 50) is
> unchanged, and so are the level thresholds (10 levels, 300,000 XP to L10). The rest of this
> section stays an estimate, as labelled.

---

## 8. Build order

1. **Fix row_bomb `rolls_used`** (§1.2) — prerequisite for both the ladder and `speed_runner`.
2. **Wire `streak_7` and `speed_runner`** — cheapest, no new queries.
3. **Wire the five count-query NFTs** — one pass through `AchievementStats`.
4. **Decide `no_rug` / `perfect_board`** before building any dispatcher.
5. **Build the dispatcher**, wire `full_collection` last.
6. **Ship ladder phase 1** (§4). Depends on 1.
7. **Server-side guest IDs + per-IP quota** (§5). Should land with or before 6. *Superseded: built —
   see §5.*
8. *Phase 2:* `powerup_activations` audit table, to fold power-up cost into the ladder denominator.
9. *Not blocking:* re-curve the level thresholds (§7).
10. **Only then** reconsider the XRD→ROLLS purchase gate.

---

## 9. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| 1 | Do the dice get real consequence, or stay cosmetic? (§1.3) | A design call — it changes every roll |
| 2 | Cut `no_rug` or `perfect_board`, and redefine the survivor? | Cut one; redefine around combo play |
| 3 | What is the otter's unique verb? | Needs a design answer before tickets are built |
| 4 | Re-curve levels, or add prestige past the ceiling? | Either; the tail is the problem |

---

## 10. Parked — revisit when player feedback says so

Decided 2026-08-21: leave the loop as it is, polish it, and wait for player feedback before any
redesign. Do not redesign a loop nobody has complained about. Recorded here so it is not re-derived
later.

**Real dice.** Map `dice.value` to a hit outcome instead of ignoring it: 1/Miss → no progress at all,
2-4 → +1 hit as today, 5/Epic → +2 hits, 6/Jackpot → completes the cell outright. Expected rolls per
board moves from a flat 102 to roughly 137 — still inside the documented 100-150 range, but variable,
so a cold run genuinely drags and a hot run visibly shortens. The pity counter and the
"always give something" floor already exist to soften a true miss; they are mostly dormant today
because nothing ever actually misses.

> **Superseded in part (checked 2026-10-11).** The "documented 100-150 range" is gone. The README
> now gives roughly 95–100 rolls to finish a board, and `server/src/game/grid.ts` bounds the count at
> 64–128 by construction (mean 102.4), noting that the old "~100-150" figure overstated the top end.
> The ~137 estimate above is analytical, not measured. "Miss" is also no longer the label for a 1
> (see §1.3).

**Heat.** Consecutive non-misses build a small XP multiplier (+10/20/35% at 5/10/20), reset to zero
by a miss. Mirrors the existing `pity_counter` plumbing exactly. Reads only `dice.value`, never who
paid for the roll, so bought and earned rolls behave identically by construction.

**The structural floor stays.** Finishing a board should keep paying its full 1,270/1,940 — that is
geometry, and it feels good for a casual guild audience finishing their first board. The defect was
never the reward; it was using that fixed number to *rank* people. Fix the ranking (§4), not the
payout.

**Otter reward bump.** `{reward: 15, xp: 30}` → roughly `{20-25, 40-50}`, weight unchanged at 5/105.
It is currently the weakest-paying chase cell, below diamond and moon, while being the one treated
as the signature mechanic.

**Otter tickets, when the raffle is built.** Natural rolls only — never wild cards or row bombs.
X-Ray reveals cell types and a wild card can target any cell, so X-Ray + wild is an existing way to
*snipe* an otter deliberately; both are purchasable, so allowing them would let spend buy drops. Cap
at 3 tickets/player/week: a completed board yields ≈3.05 otter completions on average (64 × 5/105,
σ≈1.70), so uncapped tickets would run near-linear in boards completed — a spend proxy again.
Guests get the full otter moment, score, confetti and all; only the ticket write is skipped, with no
retroactive credit on connecting, which closes farm-many-identities-then-connect-the-lucky-one.

## Provenance

Three independent design passes over the code, then a judged synthesis; findings re-verified by
hand before landing here.

**Not verified**, and stated plainly by the passes that produced them: the XP and roll averages are
analytical, not measured; no live database was queried; the guest-faucet exposure in §5 was
structural, with no evidence of actual exploitation, and its guest-id hole has since been closed;
the streak decay logic was read, not executed.
