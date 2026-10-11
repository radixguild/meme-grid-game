"use client";

import { useEffect, useState } from "react";

/**
 * PhaseBanner
 *
 * Tells players that ROLLS is a balance on our server, not a token in their
 * wallet. Dismissible per-browser.
 *
 * It used to say "play and earn — your ROLLS balance is tracked. On-chain
 * distribution launches in Phase 2." Two problems, both worth not reintroducing:
 *
 *   - "earn" was false for the audience actually reading it. A new player gets 15
 *     ROLLS once; streaks pay 0 ROLLS at every tier (game/streaks.ts), and the
 *     trial cannot reach the completed board that drops settle on. Levelling up
 *     pays, but that is a long way past the banner.
 *   - "on-chain distribution launches in Phase 2" had no implementation, no date
 *     and no owner — `services/vault.ts` still carries a bare `TODO Phase 2` for
 *     it. Promising a launch nothing implements is the thing this banner should
 *     least be doing.
 *
 * ⚠️ `NEXT_PUBLIC_REWARD_PHASE` is NOT the server's `phase`. The server derives
 * that from `VAULT_COMPONENT` (whether the purchase vault is deployed); this is a
 * separate, manually-set build-time flag about reward distribution. They can
 * disagree, and nothing reconciles them.
 *
 * Controlled by `NEXT_PUBLIC_REWARD_PHASE`:
 *   "1" (default) — show banner
 *   "2"           — hide banner
 */
export default function PhaseBanner() {
  // default `true` (hidden) to avoid SSR flash — real state loaded in effect
  const [dismissed, setDismissed] = useState(true);
  const phase = process.env.NEXT_PUBLIC_REWARD_PHASE ?? "1";

  useEffect(() => {
    if (phase === "2") return;
    const seen =
      typeof window !== "undefined" &&
      localStorage.getItem("phase1_banner_dismissed") === "yes";
    setDismissed(seen);
  }, [phase]);

  if (phase !== "1" || dismissed) return null;

  return (
    <div className="bg-amber-900/30 border-b border-amber-600/40 text-amber-100 text-sm">
      <div className="max-w-6xl mx-auto px-4 py-2 flex items-center justify-between gap-3">
        {/* Short on phones, full from sm: up. The full sentence wrapped to three
            lines at 375px — about 15% of the viewport spent on a dismissible
            notice, on every page, above the game itself. */}
        <span className="flex-1">
          <strong className="font-semibold">Phase 1:</strong>
          <span className="sm:hidden"> ROLLS live in your account here, not in your wallet.</span>
          <span className="hidden sm:inline"> ROLLS is a balance in your account here, not a token in your wallet. Achievement NFTs you earn are minted to your wallet on Radix.</span>
        </span>
        <button
          onClick={() => {
            localStorage.setItem("phase1_banner_dismissed", "yes");
            setDismissed(true);
          }}
          className="shrink-0 text-amber-200 hover:text-amber-50 text-xs underline"
          aria-label="Dismiss"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
