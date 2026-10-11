"use client";
import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@/hooks/useWallet";
import ConnectButton from "@/components/ConnectButton";
import { useGame } from "@/hooks/useGame";
import {
  API_URL,
  XRD_PER_ROLL_FALLBACK,
  BOARD_COST_LABEL,
  MAX_XRD_PER_PURCHASE,
  ROLLS_PER_BOARD_TYPICAL,
} from "@/lib/constants";
import { buyMemeManifest } from "@/lib/manifests";
import { formatMeme } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

interface TokenInfo {
  vault_component: string | null;
  meme_resource: string | null;
  phase: number;
  /** XRD required per ROLL — authoritative, served from the deployed vault's price. */
  xrd_per_roll?: number;
}

export default function ShopPage() {
  const { account, connected, isGuest, rdt } = useWallet();
  const { player, refresh } = useGame();
  // null = the player has not typed anything yet, so the field shows the
  // price-derived default below. Storing the default in state instead would mean
  // writing it from an effect once /token/info lands — the cascading-render
  // pattern react-hooks/set-state-in-effect exists to catch.
  const [xrdAmount, setXrdAmount] = useState<string | null>(null);
  const [tokenInfo, setTokenInfo] = useState<TokenInfo | null>(null);
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    apiFetch(`${API_URL}/token/info`)
      .then((r) => r.json())
      .then((data) => data.ok && setTokenInfo(data))
      .catch(() => {});
  }, []);

  const xrdPerRoll = tokenInfo?.xrd_per_roll ?? XRD_PER_ROLL_FALLBACK;
  // What the field shows: the player's own entry, or one ROLL's worth at the live
  // rate. The old default was the literal "1", from when a ROLL cost 1 XRD; at
  // 20 XRD/ROLL that renders a dead Buy button on first paint.
  const xrdInput = xrdAmount ?? String(xrdPerRoll);
  // Number.isFinite, not just a parse: `type="number"` discourages non-numeric
  // input but does not prevent it, and NaN slips through every comparison that
  // guards this page — `NaN <= 0` is false, so a NaN output would leave the Buy
  // button ENABLED and build a manifest with a junk Decimal in it.
  const parsed = parseFloat(xrdInput || "0");
  const xrdEntered = Number.isFinite(parsed) ? parsed : 0;
  // Whole ROLLS only: the balance is an integer and every price in the game is a
  // whole number, so a fractional purchase would strand dust that cannot be spent.
  const memeOutput = Math.floor(xrdEntered / xrdPerRoll);
  // What the vault will actually take, and what it will hand straight back. The
  // blueprint returns the remainder rather than keeping it, so a non-multiple amount
  // is not a loss — but the player should be told that before they sign, rather than
  // left to work it out from a wallet receipt.
  const xrdCost = memeOutput * xrdPerRoll;
  const xrdChange = Math.max(0, xrdEntered - xrdCost);
  const belowMinimum = xrdEntered > 0 && memeOutput < 1;
  const isPhase2 = tokenInfo?.phase === 2 && !!tokenInfo.vault_component;
  // Until /token/info answers we do not know which phase we are in. Rendering
  // either branch on a guess flashes false copy — a buy form that may not exist,
  // or a "purchases paused" notice on a working vault.
  const phaseKnown = tokenInfo !== null;

  const handleBuyOnChain = useCallback(async () => {
    if (!rdt || !account || !tokenInfo?.vault_component) return;
    setProcessing(true);
    setStatus("Building transaction...");

    try {
      const manifest = buyMemeManifest(tokenInfo.vault_component, account, xrdInput);
      setStatus("Waiting for wallet approval...");

      const result = await rdt.walletApi.sendTransaction({
        transactionManifest: manifest,
      });

      if (result.isErr()) {
        setStatus(`Transaction failed: ${result.error.message}`);
        setProcessing(false);
        return;
      }

      const txHash = result.value.transactionIntentHash;
      setStatus(`Transaction submitted! Verifying: ${txHash.slice(0, 16)}...`);

      // Wait briefly for commit, then verify deposit
      await new Promise((r) => setTimeout(r, 5000));

      const depositRes = await apiFetch(`${API_URL}/token/${account}/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tx_hash: txHash }),
      });
      const depositData = await depositRes.json();

      if (depositData.ok) {
        setStatus(`Credited ${formatMeme(depositData.credited)} ROLLS!`);
        refresh();
      } else {
        setStatus(`Deposit verification pending: ${depositData.error}. Balance will update shortly.`);
      }
    } catch (err: any) {
      setStatus(`Error: ${err.message}`);
    }
    setProcessing(false);
  }, [rdt, account, tokenInfo, xrdInput, refresh]);

  // Guests must never reach the on-chain buy flow: connected is !!account and
  // guests hold a guest_* pseudo-account, so !connected alone does not stop them.
  if (!connected || isGuest) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-20">
        <h1 className="text-3xl font-bold neon-glow">Token Shop</h1>
        <p className="text-gray-400">
          {isGuest
            ? `Guest mode is play-only — connect your Radix wallet to ${isPhase2 ? "buy ROLLS" : "see your ROLLS balance"}`
            : `Connect your wallet to ${isPhase2 ? "buy ROLLS" : "see your ROLLS balance"}`}
        </p>
        <ConnectButton />
      </div>
    );
  }

  return (
    <div className="max-w-lg lg:max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-2xl font-bold neon-glow">Token Shop</h1>

      {/* Current balance */}
      {player && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 p-4 text-center">
          <div className="text-sm text-gray-500">Your ROLLS Balance</div>
          <div className="text-3xl font-bold text-yellow-400">{formatMeme(player.meme_balance)}</div>
          <div className="text-xs text-gray-400 mt-1">
            Deposited: {formatMeme(player.total_meme_deposited)} | Spent: {formatMeme(player.total_meme_spent)}
          </div>
        </div>
      )}

      {/* Exchange card. Phase 2 = the server reports a live vault component, so
          there is a real on-chain buy path. Phase 1 = there is none, and the page
          must not pretend otherwise. */}
      <div className="neon-border rounded-xl p-6 bg-[var(--bg-card)]">
        <h2 className="text-lg font-bold mb-4 text-center">
          {isPhase2 ? "Buy ROLLS" : "Buying ROLLS"}
        </h2>

        {!phaseKnown ? (
        <div className="text-xs text-center text-gray-400 py-6">Loading...</div>
        ) : isPhase2 ? (
        <div className="flex flex-col gap-4">
          {/* XRD input */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">You Pay (XRD)</label>
            <input
              type="number"
              min={xrdPerRoll}
              max={MAX_XRD_PER_PURCHASE}
              step={xrdPerRoll}
              value={xrdInput}
              onChange={(e) => setXrdAmount(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-3 text-lg font-bold text-white focus:border-green-500 focus:outline-none"
              placeholder={String(xrdPerRoll)}
            />
          </div>

          {/* Arrow */}
          <div className="text-center text-2xl text-gray-400">&#x2193;</div>

          {/* ROLLS output */}
          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wider mb-1 block">You Receive (ROLLS)</label>
            <div className="w-full bg-gray-900/50 border border-gray-700/50 rounded-lg px-4 py-3 text-lg font-bold text-green-400">
              {formatMeme(memeOutput)} ROLLS
            </div>
          </div>

          {/* Rate info, plus what is actually being charged. A greyed-out Buy button
              with no reason beside it reads as a broken page. */}
          <div className="text-xs text-gray-500 text-center">
            Rate: {xrdPerRoll} XRD = 1 ROLL
          </div>
          {/* The rate alone tells a player nothing about what a session costs, and a
              board is what they are actually deciding about — see
              ROLLS_PER_BOARD_TYPICAL for where the number comes from. */}
          <div className="text-[11px] text-gray-400 text-center">
            Starting a board is {BOARD_COST_LABEL}. Filling one takes about{" "}
            {ROLLS_PER_BOARD_TYPICAL} ROLLS, one per roll of the die.
          </div>
          {belowMinimum && (
            <div className="text-xs text-yellow-500/90 text-center">
              Minimum purchase is {xrdPerRoll} XRD &mdash; that buys 1 ROLL.
            </div>
          )}
          {xrdChange > 0 && (
            <div className="text-xs text-gray-400 text-center">
              You&rsquo;ll pay {xrdCost} XRD for {memeOutput} ROLLS. The remaining{" "}
              {Number(xrdChange.toFixed(4))} XRD comes back as change.
            </div>
          )}

          {/* Non-refundable warning */}
          <div className="bg-yellow-900/20 border border-yellow-600/40 rounded-lg p-3 text-center">
            <p className="text-xs text-yellow-500 font-bold mb-1">Non-Refundable Purchase</p>
            <p className="text-[11px] text-yellow-500/70 leading-relaxed">
              ROLLS are game credits for entertainment only.
              All purchases are final &mdash; no refunds, exchanges, or buybacks.
              ROLLS has no monetary value outside the game.
            </p>
            <p className="text-[11px] text-yellow-500/70 leading-relaxed mt-2">
              Players earn meme-coin drops and NFT rewards through gameplay &mdash;
              lucky drops, milestones, and tournaments.
              Note: you need a small amount of XRD in your wallet to cover network fees.
              {/* Do NOT promise free XRD here. server/src/routes/faucet.ts only records a
                  'pending' claim — the XRD send is an unimplemented TODO and there is no
                  funded faucet wallet, so any "you will receive free XRD" copy is a
                  promise the game cannot keep. */}
            </p>
          </div>

          {/* Buy button */}
          <button
            onClick={handleBuyOnChain}
            disabled={processing || memeOutput <= 0}
            className="w-full py-3 rounded-xl font-bold text-lg bg-gradient-to-r from-green-600 to-cyan-600 hover:from-green-500 hover:to-cyan-500 text-white shadow-lg shadow-green-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {processing ? "Processing..." : "Buy with Radix Wallet"}
          </button>

          {/* Phase indicator */}
          <div className="text-xs text-center text-gray-400">
            <span className="text-green-500">On-chain ROLLS purchases active</span>
          </div>
        </div>
        ) : (
        <div className="flex flex-col gap-4">
          {/* Do NOT put a credit button here. The only direct-credit path is Mode 2
              of POST /token/:address/deposit, which the C-001..H-003 audit put behind
              adminAuth — a player click 401s. The button this replaced ("Get Free ROLLS
              (Test Mode)") did exactly that, and called a live production game a test
              mode. Phase 1 has no buy path: say so, offer nothing. */}
          <div className="bg-yellow-900/20 border border-yellow-600/40 rounded-lg p-4 text-center">
            <p className="text-sm text-yellow-500 font-bold mb-2">ROLLS purchases are paused</p>
            <p className="text-xs text-yellow-500/70 leading-relaxed">
              The v1 token vault has been retired and its replacement is not deployed yet,
              so there is currently no way to buy ROLLS with XRD. No date is set for this
              &mdash; nothing is pending on your side, and no payment is being collected.
            </p>
          </div>

          <div className="text-xs text-gray-500 leading-relaxed text-center">
            Your ROLLS balance is unaffected and the game is fully playable with it.
            Leveling up still pays ROLLS &mdash; daily check-ins and streaks pay XP bonuses
            and power-ups, not ROLLS.
          </div>

          {/* Phase indicator */}
          <div className="text-xs text-center text-gray-400">
            <span className="text-yellow-500/80">On-chain purchases offline &mdash; vault v2 pending</span>
          </div>
        </div>
        )}
      </div>

      {/* Status message */}
      {status && (
        <div className="animate-slide-up bg-[var(--bg-card)] border border-green-500/30 rounded-lg p-3 text-center text-sm">
          {status}
        </div>
      )}

      {/* Quick buy presets — phase 2 only; they drive the XRD input, which phase 1
          does not render.

          Priced in ROLLS and multiplied by the LIVE rate, never hardcoded in XRD.
          These were 0.5 / 1 / 5 / 10 XRD, from when a ROLL cost 1 XRD. At the launch
          rate of 20 every one of them buys zero ROLLS, so each preset set an amount
          the Buy button then refused — four dead buttons on the shop's main control.
          Deriving from xrdPerRoll means they cannot go stale again the next time the
          owner calls set_price. */}
      {isPhase2 && (
      <div className="grid grid-cols-4 gap-2">
        {[1, 25, 100, 250]
          // A fixed ROLLS amount can exceed what the vault takes in one transaction
          // once the rate is high enough — 250 ROLLS is 12,500 XRD at 50 XRD/ROLL,
          // over the blueprint's MAX_XRD, so the buy would revert. Drop those rather
          // than offer a button that cannot work.
          .filter((rolls) => rolls * xrdPerRoll <= MAX_XRD_PER_PURCHASE)
          .map((rolls) => {
          const amt = String(rolls * xrdPerRoll);
          return (
            <button
              key={rolls}
              onClick={() => setXrdAmount(amt)}
              className={`py-2 rounded-lg text-sm font-medium border transition-colors ${
                xrdInput === amt
                  ? "bg-green-600/20 text-green-400 border-green-500/30"
                  : "bg-[var(--bg-card)] text-gray-500 border-gray-700/40 hover:text-gray-300"
              }`}
            >
              <div>{rolls} ROLLS</div>
              <div className="text-[10px] opacity-70">{amt} XRD</div>
            </button>
          );
        })}
      </div>
      )}

      {/* Info */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 p-4 text-xs text-gray-500">
        <h3 className="font-bold text-gray-400 mb-2">How it works</h3>
        <ul className="space-y-1">
          <li>
            1. {isPhase2
              ? `Buy ROLLS with XRD (${xrdPerRoll} XRD = 1 ROLL)`
              : "Get ROLLS from your starting balance and by leveling up (buying is paused)"}
          </li>
          <li>2. Start a board &mdash; {BOARD_COST_LABEL}</li>
          <li>3. Each dice roll costs 1 ROLLS</li>
          <li>4. Complete the grid to earn XP and unlock NFTs</li>
        </ul>
      </div>
    </div>
  );
}
