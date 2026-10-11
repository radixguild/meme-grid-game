// Single source of truth for the game's ROLLS prices.
//
// These were previously duplicated as local consts in each route. That is exactly
// how routes/daily.ts came to credit "free rolls" at 10 ROLLS each while a roll
// actually cost 1 — a silent 10x over-credit that survived because the two numbers
// lived in different files. Import from here; never re-declare a price.

/** ROLLS to roll once. This is the atomic unit the currency is named after — it
 *  is not a tuning dial. Session length is set by how many rolls a board takes
 *  (~102, bounded to 64-128 — see game/grid.ts), not by this number. */
export const ROLL_COST = 1;

/** ROLLS to start a new board.
 *
 *  Cut 50 -> 5 on 2026-08-21, then 5 -> 0 on 2026-08-23 (#28).
 *
 *  At 50 this was an unconditional up-front tax worth 25-33% of a board's all-in
 *  cost, and being all-or-nothing it walled players off at the worst moment: a
 *  player holding 40 ROLLS could afford 40 more rolls but could not start anything.
 *  At 0 the board is a free project map and the ROLL is the only sink, which is the
 *  point — a ROLL is a receipt for work, so the metered action carries the cost and
 *  the gate carries none.
 *
 *  ⚠️ The runway arithmetic that used to live here is gone rather than updated. It
 *  read "500 ROLLS is ~5 boards", which stopped being true in the same commit that
 *  set this to 0: FREE_STARTING_BALANCE is 15, about 16% of ONE board. A board is
 *  94.6-100.2 ROLLS all-in, measured over 3,000 simulated boards against the real
 *  engine. Derive runway from the constants, never from a sentence in a comment. */
export const BOARD_COST = 0;

/** XRD required to buy one ROLL — PHASE 1 FALLBACK ONLY.
 *
 *  ⚠️ The DEPLOYED VAULT IS AUTHORITATIVE, not this constant. As of v2 the rate is
 *  component state (`xrd_per_roll`), settable by the owner via `set_price` without a
 *  redeploy — precisely so the buy rail can be tuned like the earn rail already can.
 *
 *  The "proper fix" this comment used to defer to phase 2 now exists:
 *  `services/vault-price.ts` reads the rate off the component (cached, with a stale
 *  fallback) and `/token/info` serves that, tagged with `xrd_per_roll_source`. So
 *  this number is reached only when there is no vault to ask — phase 1, or a Gateway
 *  outage with a cold cache.
 *
 *  Import it from vault-price, not from here, unless you specifically mean "the
 *  value to use when no component exists". Routes that quote a price to a player
 *  should call `getXrdPerRoll()`. */
export const XRD_PER_ROLL = 112;

/** Free ROLLS credited once, on a player's first visit (Phase 1 onboarding). */
export const FREE_STARTING_BALANCE = 15;

/** ROLLS for N rolls — use this rather than multiplying by a literal. */
export function memeForRolls(rolls: number): number {
  return rolls * ROLL_COST;
}
