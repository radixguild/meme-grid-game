import { Router } from "express";
import { validateAddress, validateBody, safeParseInt } from "../middleware/validate";
import { requireAuth } from "../middleware/require-auth";
import { adminAuth } from "../middleware/admin-auth";
import { getPlayer, getOrCreatePlayer, creditMemeBalance, getPlayerWithLevelInfo } from "../db/queries/players";
import { getDb } from "../db/connection";
import { verifyBuyMemeTransaction } from "../services/tx-verifier";
import { recordCreditOnly } from "../db/queries/roll-credits";
// Prices come from economy.ts, never from literals here. This route hardcoded
// board_cost: 50 and roll_cost: 1, so /token/info kept serving 50 after the price
// changed in economy.ts — every client reading this endpoint would have shown the
// wrong price. Exactly the duplication economy.ts's own header was written about.
// FREE_STARTING_BALANCE is served for the same reason board_cost is: the tokenomics
// page hardcoded 500 and kept telling players that for the whole life of the 15-ROLL
// trial. A number a player makes a decision on does not belong in client source.
import { ROLL_COST, BOARD_COST, FREE_STARTING_BALANCE } from "../game/economy";
// XRD_PER_ROLL is deliberately NOT imported here any more. As of vault v2 the rate
// is component state the owner can change with `set_price`, so serving the constant
// meant this endpoint could quote a price the vault had stopped charging. The
// constant survives as the phase-1 fallback INSIDE getXrdPerRoll, which is the only
// place that should still know about it.
import { getXrdPerRoll } from "../services/vault-price";

const router = Router();

const VAULT_COMPONENT = process.env.VAULT_COMPONENT || "";
const MEME_RESOURCE = process.env.MEME_RESOURCE || "";

// GET /api/token/info — vault component info (MUST be before :address routes)
//
// async because the price is read from the deployed vault (cached; see
// services/vault-price.ts). getXrdPerRoll never rejects, but the try/catch stays:
// under express 4 an unhandled rejection in a handler HANGS the request instead of
// failing it, and this is the endpoint the whole client bootstraps from.
router.get("/token/info", async (_req, res) => {
  try {
    const price = await getXrdPerRoll();
    res.json({
      ok: true,
      vault_component: VAULT_COMPONENT || null,
      meme_resource: MEME_RESOURCE || null,
      // Kept as `meme_per_xrd` for wire compatibility with the existing client.
      // The value is now XRD-per-ROLL, not ROLLS-per-XRD — see xrd_per_roll below,
      // which is the field new code should read.
      meme_per_xrd: 1 / price.value,
      xrd_per_roll: price.value,
      // "component" | "component-stale" | "config". After the v2 deploy this is the
      // fastest check that the live read works: `config` in production means it does
      // not, and the shop is quoting a compiled-in number again.
      xrd_per_roll_source: price.source,
      board_cost: BOARD_COST,
      roll_cost: ROLL_COST,
      free_starting_balance: FREE_STARTING_BALANCE,
      phase: VAULT_COMPONENT ? 2 : 1,
    });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: `token info failed: ${err?.message ?? err}` });
  }
});

// GET /api/token/:address/balance — server-tracked MEME balance
// A read never creates a player row (MG-8): an unseen address reads as zeros,
// which is exactly what a fresh row would have held.
router.get("/token/:address/balance", validateAddress, requireAuth(), (req, res) => {
  const { address } = req.params;
  const player = getPlayer(address);
  res.json({
    ok: true,
    meme_balance: player?.meme_balance ?? 0,
    total_deposited: player?.total_meme_deposited ?? 0,
    total_spent: player?.total_meme_spent ?? 0,
  });
});

// POST /api/token/:address/deposit — verify on-chain tx and credit MEME balance
//
// No router-level requireAuth() here, deliberately: the two modes below have
// different authorization and a single per-route mode would either under- or
// over-gate one of them.
//   Mode 1 (on-chain verification) is a player claiming their OWN deposit —
//     gated inline, required-for-wallets, right before it runs (below).
//   Mode 2 (admin direct credit) is gated by BOTH adminAuth (the operator
//     secret) AND, as of 2026-09-08, the same required-for-wallets check as
//     Mode 1 — bigdev ruling: "wallet proofs like Mode-1, not adminAuth
//     [alone]" (docs/PROJECT-STATE.md item 3/14 continuation). Rationale:
//     adminAuth alone gated *who* can call this route, but said nothing about
//     *which* address they can mint into — a leaked ADMIN_TOKEN used to be
//     able to credit ANY checksum-valid `account_…` address, present or not.
//     required-for-wallets closes that: a real account now also needs a live
//     ROLA session for ITSELF, same as Mode 1. Guest ids are UNCHANGED —
//     required-for-wallets never gates them, so admin-credits-a-guest still
//     needs only the operator token, exactly as before this PR.
//     Operational note: this makes it impossible for an operator to direct-
//     credit a real wallet that is not currently holding a live session for
//     itself — there is no way for the operator to supply someone else's
//     session token in the same request. Nothing in the client currently
//     calls this branch (shop/page.tsx only ever sends `tx_hash`, never
//     `amount` — see PR body), so this lands dark for live traffic; it only
//     tightens what a direct API call (script/operator) can do.
router.post("/token/:address/deposit", validateAddress, async (req, res) => {
  const { address } = req.params;
  const { tx_hash, amount } = req.body;

  // No getOrCreatePlayer() here (MG-8). It used to run first, before any auth or
  // input check, so an empty-body POST per derived address inserted a players
  // row each time and inflated the public player count. Each mode now creates
  // the row only once it is about to credit it.

  // Mode 1: On-chain verification (Phase 2 — when vault is deployed)
  if (tx_hash && VAULT_COMPONENT && MEME_RESOURCE) {
    // required-for-wallets: this credits real balance against an on-chain
    // address, so a real `account_…` address needs a proven ROLA session —
    // the item-14 hole otherwise lets anyone submit a tx_hash against a
    // checksum-valid but unowned address. Guests never reach Mode 1 (no
    // VAULT_COMPONENT-relative tx_hash to submit) but are unaffected either
    // way — see docs/PROJECT-STATE.md items 3/14.
    let authorized = false;
    requireAuth({ mode: "required-for-wallets" })(req, res, () => {
      authorized = true;
    });
    if (!authorized) return; // requireAuth already sent the 401/403 response

    // Check if already processed
    const existing = getDb()
      .prepare("SELECT 1 FROM deposits WHERE tx_hash = ?")
      .get(tx_hash);
    if (existing) {
      res.status(409).json({ ok: false, error: "Deposit already processed" });
      return;
    }

    try {
      const result = await verifyBuyMemeTransaction(tx_hash, address);
      if (!result.valid) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }

      // Record verified deposit (atomic — INSERT and credit together)
      getDb().transaction(() => {
        getOrCreatePlayer(address);
        getDb()
          .prepare("INSERT INTO deposits (radix_address, tx_hash, xrd_amount, meme_amount, verified) VALUES (?, ?, ?, ?, 1)")
          .run(address, tx_hash, result.xrdAmount, result.memeAmount);
        // Ledger (011) with the tx hash as source_ref, so a replayed hash cannot
        // double-credit and paid rolls are separable from every giveaway source.
        recordCreditOnly({
          address,
          amount: result.memeAmount,
          source: "purchase",
          sourceRef: tx_hash,
          note: `verified on-chain — ${result.xrdAmount} XRD`,
        });
        creditMemeBalance(address, result.memeAmount);
      })();

      res.json({
        ok: true,
        method: "on-chain",
        credited: result.memeAmount,
        xrd_spent: result.xrdAmount,
        player: getPlayerWithLevelInfo(address),
      });
      return;
    } catch {
      res.status(500).json({ ok: false, error: "Deposit verification failed" });
      return;
    }
  }

  // Mode 2: Direct credit — ADMIN ONLY. This branch creates MEME balance out of
  // nothing, and requireAuth() in legacy mode trusts the URL address, so without
  // the token gate any anonymous caller could credit 100,000 MEME per request
  // (60 POST/min per IP): unlimited free rolls, and farmed achievements that
  // trigger server-paid mainnet NFT mints off the hot signer wallet.
  if (amount) {
    // required-for-wallets, same idiom as Mode 1 above — independent of and
    // additional to adminAuth below, not a replacement for it (see the route
    // header comment). A real `account_…` address needs its own live ROLA
    // session; a guest id keeps working through adminAuth alone, unchanged.
    let authorized = false;
    requireAuth({ mode: "required-for-wallets" })(req, res, () => {
      authorized = true;
    });
    if (!authorized) return; // requireAuth already sent the 401/403 response

    adminAuth(req, res, () => {
      const memeAmount = safeParseInt(amount, 1, 100000);
      if (memeAmount === null) {
        res.status(400).json({ ok: false, error: "Invalid amount (integer 1-100000)" });
        return;
      }

      if (tx_hash) {
        try {
          getDb()
            .prepare("INSERT INTO deposits (radix_address, tx_hash, xrd_amount, meme_amount, verified) VALUES (?, ?, ?, ?, 0)")
            .run(address, tx_hash, String(memeAmount / 100), memeAmount);
        } catch {
          res.status(409).json({ ok: false, error: "Deposit already processed" });
          return;
        }
      }

      getOrCreatePlayer(address);

      // Direct credit is NOT on-chain verified, so it is recorded as 'promo'
      // rather than 'purchase'. Keeping it out of 'purchase' is the point: the
      // source breakdown must not report unverified credits as revenue.
      recordCreditOnly({
        address,
        amount: memeAmount,
        source: "promo",
        sourceRef: tx_hash ?? null,
        note: "admin direct credit (unverified)",
      });
      creditMemeBalance(address, memeAmount);

      res.json({
        ok: true,
        method: "direct",
        credited: memeAmount,
        player: getPlayerWithLevelInfo(address),
      });
    });
    return;
  }

  res.status(400).json({ ok: false, error: "Provide tx_hash for an on-chain deposit (direct credit requires an admin token)" });
});

export default router;
