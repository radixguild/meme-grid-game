// MEME GRID's dedicated dApp Definition account:
//   account_rdx12945s526fxx2c6faj3pykzl6jgl90mhwtnnsgp773r3rp37cstq4lx  ("MEME GRID")
// Configured on-chain 2026-07-18 (separation S1): account_type="dapp definition",
// name="MEME GRID", claimed_websites=[memegrid.radixguild.com],
// claimed_entities=[vault, ROLLS, NFT, package]. Wallet connect now identifies as
// "MEME GRID". The verified website↔dApp backlink is public/.well-known/radix.json.
//
// Separation S2 has LANDED too (phase2a): re-verified against live mainnet
// 2026-07-26 — the guild dApp def
// (account_rdx12yh4fwevmvnqgd3ppzau66cm9xu874srmrt9g2cye3fa8j8y78z9sq) now claims
// only its own 3 entities + radixguild.com. It no longer claims this game's
// website, vault, ROLLS, NFT collection or package.
//
// ⚠️ Because the guild released memegrid.radixguild.com, DEPLOYING THIS REPOINT IS
// NOW REQUIRED, not optional: any deployment still sending the guild's dApp def for
// this origin fails wallet-connect verification in both directions (the guild no
// longer claims the site, and radix.json no longer names the guild).
//
// Still guild-branded and NOT fixable here: the ROLLS + NFT resources have
// `dapp_definitions` locked (owner DenyAll) pointing at the guild — only a v2
// redeploy changes that (separation S4).
//
// Set via NEXT_PUBLIC_DAPP_DEF in env. No hardcoded fallback — wallet connect
// fails cleanly if unset, rather than silently pointing at the old shared account.
export const DAPP_DEF = process.env.NEXT_PUBLIC_DAPP_DEF || "";

// ⛔ The v1 vault `component_rdx1czh262wv…tj6lgxy` is RETIRED and must never be a fallback
// again. Its owner AND admin roles both require one badge, held in
// `account_rdx12xgra93…z223v2x`. That account's key is held, so the vault's XRD is
// recoverable with a proof of the badge; moving the badge to another operator-held account is
// planned and has not happened. The owner rule's updater is `None`, so the rule itself can
// never be reassigned: every XRD that reaches the vault can leave only through that one badge.
//
// Same treatment as DAPP_DEF above, for the same reason and then some: no hardcoded
// fallback, so a missing env fails cleanly instead of silently routing player funds into
// the retired v1 vault. See docs/VAULT-V1-LOST.md.
export const VAULT_COMPONENT = process.env.NEXT_PUBLIC_VAULT_COMPONENT || "";

// Same treatment as VAULT_COMPONENT above, which it should have had all along: this
// defaulted to resource_rdx1t4trlp2…63y6sdrl7, which is `memeTokenV1Dead.memeResource`
// in server/deploy-state.json — the RETIRED v1 token. A missing env var therefore
// resolved, silently and confidently, to a resource the game no longer uses, one line
// below a comment explaining why that exact pattern was removed from VAULT_COMPONENT.
//
// Latent rather than live: nothing outside this file reads either constant today. But
// the v2 deploy is the moment a stale token address gets picked up by new code, so it
// fails closed now instead. Set NEXT_PUBLIC_MEME_RESOURCE at the repoint.
export const MEME_RESOURCE = process.env.NEXT_PUBLIC_MEME_RESOURCE || "";

export const GATEWAY =
  process.env.NEXT_PUBLIC_GATEWAY || "https://mainnet.radixdlt.com";

export const NETWORK = process.env.NEXT_PUBLIC_NETWORK || "mainnet";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3004/api";

export const NFT_RESOURCE =
  process.env.NEXT_PUBLIC_NFT_RESOURCE || "resource_rdx1n2mt0t39c2ky2r99t39e78f9zmn8kxyngewutzrfmlku0sl0qv6gsf";

// Game config — DISPLAY FALLBACKS ONLY, mirrored from server/src/game/economy.ts.
//
// ⚠️ These went stale the moment BOARD_COST was cut 50 -> 5 server-side, and the
// whole UI spent that time telling players a board cost ten times what it does.
// `/api/token/info` serves board_cost and roll_cost from economy.ts; anything that
// quotes a price to a player should prefer the API value and fall back to these
// only before that request resolves.
export const BOARD_COST = 0;
export const ROLL_COST = 1;
// ⚠️ Do NOT price anything from a client constant. The rate is component state as
// of vault v2 (owner-settable via set_price, no redeploy), and /api/token/info
// serves it as `xrd_per_roll`. This fallback exists only so the shop can render
// before that request resolves; anything that quotes a price to a player must use
// the API value. Hardcoding prices in two places is what made /token/info serve a
// stale board_cost after economy.ts changed.
export const XRD_PER_ROLL_FALLBACK = 112;

/** The one-time free grant a brand-new address or guest receives, in ROLLS.
 *
 *  DISPLAY FALLBACK ONLY — mirrors FREE_STARTING_BALANCE in
 *  server/src/game/economy.ts, which is what actually gets credited. Prefer
 *  `free_starting_balance` from /api/token/info wherever the request has resolved.
 *
 *  ⚠️ This was hardcoded as 500 in four separate places and stayed there after the
 *  grant was cut to 15, so the landing page, the guest prompt, the how-to-play
 *  walkthrough and the tokenomics page all advertised ~33x what a player got. It is
 *  a single constant now so the next change moves one number, not four.
 *
 *  Honest framing matters more than the number: 15 ROLLS is a look, not a board —
 *  a board takes ~95 rolls, and only a COMPLETED board pays anything. Copy that
 *  implies the trial finishes a board is false. */
export const FREE_STARTING_ROLLS = 15;

/** Largest single purchase the vault accepts, in XRD.
 *
 *  Mirrors MAX_XRD in scrypto/meme-token/src/lib.rs, which is a CONSTANT in the
 *  WASM — unlike the price, it cannot be changed without a redeploy. That matters
 *  for anything denominated in ROLLS: at a high enough rate a fixed ROLLS amount
 *  costs more XRD than the vault will take in one transaction, and the buy reverts
 *  on the blueprint's own bound. Anything offering a ROLLS quantity must check the
 *  XRD it works out to against this. */
export const MAX_XRD_PER_PURCHASE = 1_000_000;

/** Roughly what a whole board costs, in ROLLS, start fee included.
 *
 *  Measured, not estimated: 3,000 simulated boards against the real engine
 *  (server/src/game/{grid,engine}.ts) cost a mean of 94.6 ROLLS with wild cards
 *  played as they are earned and 100.2 with them never played — BOARD_COST plus
 *  ~90-95 paid rolls, after extra-turn cells and wild cards, both of which are
 *  free. p95 is 103-108 and the observed maximum is 117.
 *
 *  Every roll adds exactly one hit to one incomplete cell, so the roll count is
 *  bounded by the sum of the 64 cell thresholds (each 1 or 2, mean 1.6): 102.4 on
 *  average and never more than 128. The long-standing "~100-150 rolls" figure
 *  overstates the top end — 150 is not reachable.
 *
 *  Shown in the shop because "1 ROLL = 20 XRD" tells a player nothing about what a
 *  session costs, and that is the number they are actually deciding about. */
export const ROLLS_PER_BOARD_TYPICAL = 95;

/** How to say the board price in copy. BOARD_COST is 0 — starting a board is free
 *  and only rolls cost — so every "New Board (0 ROLLS)" string needs to read as
 *  "free" instead. Single-sourced so the wording follows the number if it ever
 *  moves off zero, rather than nine call sites drifting apart. */
export const BOARD_COST_LABEL = BOARD_COST > 0 ? `${BOARD_COST} ROLLS` : "free";

export const GRID_SIZE = 8;

// Number of achievement NFTs a player can ACTUALLY earn right now.
//
// The server catalog lists 23, but 10 of them have unlock conditions that are
// not implemented (6 threshold on stats the award engine is never given, 4 use
// `special:` conditions nothing evaluates), so "collect all 23" is false.
// Source of truth is `OBTAINABLE_NFT_COUNT` in server/src/game/nfts.ts, pinned
// by server/src/game/__tests__/nft-obtainability.test.ts.
//
// Used for static marketing copy only. Anything rendering the live catalog
// should count entries with `obtainable !== false` instead of using this.
export const OBTAINABLE_NFT_COUNT = 13;
