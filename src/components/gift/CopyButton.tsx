"use client";

import { useState } from "react";

/**
 * Copies a value to the clipboard with a brief confirmation.
 *
 * CONTRACT: the value must ALSO be rendered next to the button, so manual copy
 * still works when the Clipboard API is unavailable (insecure context, denied
 * permission). The catch below is deliberately silent — a failed copy has no
 * error UI, and the visible value is the entire fallback. On /gift this matters
 * more than usual: a donor who cannot copy the address must be able to read it.
 */
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  return (
    <button
      onClick={copy}
      className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-600/30 border border-purple-500/40 text-purple-300 hover:bg-purple-600/50 transition-colors"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}
