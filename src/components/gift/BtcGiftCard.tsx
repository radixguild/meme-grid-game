"use client";

import { useState } from "react";
import { BTC_PRESETS, bip21Uri } from "@/lib/gift";
import { CopyButton } from "./CopyButton";
import { GiftQr } from "./GiftQr";

const ANY = "any" as const;

/**
 * BTC gift rail. A BIP-21 URI carries the amount, so unlike the XRD rail the
 * QR changes as the donor picks a preset — scan and the amount is already
 * filled in. "Any amount" drops the amount parameter entirely rather than
 * sending a zero.
 *
 * PRIVACY, stated plainly because donors deserve to know: this is ONE static
 * address. Every gift to it is publicly linkable to every other, forever, and
 * to whoever else has seen it. Rotating per donor (BIP-47 payment codes, or an
 * xpub with a fresh derived address per view) is deliberately NOT built — it
 * needs key material this app must never hold.
 *
 * `address` is already validated by lib/gift (bech32-checksummed for bc1…) —
 * this component never sees an unchecked destination.
 */
export function BtcGiftCard({ address }: { address: string }) {
  const [amount, setAmount] = useState<string>(ANY);
  const uri = bip21Uri(address, amount === ANY ? undefined : amount, "Meme Grid");

  const chip = (active: boolean) =>
    `px-3 py-1.5 rounded-lg text-xs font-bold transition-colors border ${
      active
        ? "bg-cyan-600/40 border-cyan-400/60 text-cyan-200"
        : "bg-gray-800/40 border-gray-700/40 text-gray-400 hover:bg-gray-700/40"
    }`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {BTC_PRESETS.map((p) => (
          <button key={p} type="button" className={chip(amount === p)} onClick={() => setAmount(p)}>
            {p} BTC
          </button>
        ))}
        <button type="button" className={chip(amount === ANY)} onClick={() => setAmount(ANY)}>
          Any amount
        </button>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <GiftQr
          value={uri}
          label={amount === ANY ? "Bitcoin address for gifts" : `Bitcoin payment code for ${amount} BTC`}
        />
        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-xs text-gray-400">
            Scan with a Bitcoin wallet
            {amount === ANY ? "" : ` — the ${amount} BTC amount is filled in for you`}, or copy the
            address below.
          </p>
          <div className="flex items-center gap-2 bg-gray-800/30 rounded-lg p-3">
            <code className="text-[11px] text-cyan-300 break-all flex-1">{address}</code>
            <CopyButton value={address} />
          </div>
          {/* A bitcoin: link opens a wallet if one is registered for the scheme
              and does nothing otherwise — which is why the address and QR above
              are not conditional on it. */}
          <a
            href={uri}
            className="inline-block px-3 py-1.5 rounded-lg text-xs font-medium bg-gray-800/40 border border-gray-700/40 text-gray-300 hover:bg-gray-700/40 transition-colors no-underline"
          >
            Open in wallet
          </a>
        </div>
      </div>

      <p className="text-[10px] text-gray-500">
        One static address — gifts to it are publicly linkable on the Bitcoin ledger. Per-donor
        addresses are not implemented.
      </p>
    </div>
  );
}
