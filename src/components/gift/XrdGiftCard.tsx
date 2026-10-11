"use client";

import { CopyButton } from "./CopyButton";
import { GiftQr } from "./GiftQr";

/**
 * XRD gift rail — address, QR, copy. No send-from-wallet control, on purpose:
 * a gift is not a game action, and a donor should never get a signing prompt
 * they did not ask for. They send from their own wallet, same as the BTC rail.
 *
 * There is no Radix equivalent of BIP-21 with broad wallet support, so the QR
 * carries the bare address — every Radix wallet's scanner reads that.
 *
 * `address` is already bech32m-checksum-validated by lib/gift — this component
 * never sees an unchecked destination.
 */
export function XrdGiftCard({ address }: { address: string }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      <GiftQr value={address} label="Radix account address for gifts" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-xs text-gray-400">
          Scan with the Radix Wallet, or copy the address and send any amount of XRD from your
          own wallet.
        </p>
        {/* Full address, never truncated — the clipboard fallback, and the only
            way a donor can check what they pasted. truncateAddress() is for
            display of addresses you already trust; this one is being copied. */}
        <div className="flex items-center gap-2 bg-gray-800/30 rounded-lg p-3">
          <code className="text-[11px] text-cyan-300 break-all flex-1">{address}</code>
          <CopyButton value={address} />
        </div>
      </div>
    </div>
  );
}
