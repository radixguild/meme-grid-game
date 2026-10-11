"use client";
import { useEffect, useMemo, useState } from "react";
import { API_URL } from "@/lib/constants";
import { useWallet } from "@/hooks/useWallet";
import type { NftDef } from "@/lib/types";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

const RARITY: Record<string, { label: string; text: string; border: string; tint: string; glow: string }> = {
  common: { label: "Common", text: "text-gray-300", border: "border-gray-600/50", tint: "bg-gray-500/10", glow: "" },
  uncommon: { label: "Uncommon", text: "text-green-400", border: "border-green-600/50", tint: "bg-green-500/10", glow: "" },
  rare: { label: "Rare", text: "text-blue-400", border: "border-blue-600/50", tint: "bg-blue-500/10", glow: "shadow-blue-500/20" },
  epic: { label: "Epic", text: "text-purple-400", border: "border-purple-600/50", tint: "bg-purple-500/12", glow: "shadow-purple-500/20" },
  legendary: { label: "Legendary", text: "text-yellow-400", border: "border-yellow-600/50", tint: "bg-yellow-500/12", glow: "shadow-yellow-500/25" },
  mythic: { label: "Mythic", text: "text-red-400", border: "border-red-600/50", tint: "bg-red-500/12", glow: "shadow-red-500/25" },
};
const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary", "mythic"];

export default function GalleryPage() {
  const { account } = useWallet();
  const [catalog, setCatalog] = useState<NftDef[]>([]);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<string>("all");

  useEffect(() => {
    apiFetch(`${API_URL}/nfts/catalog`)
      .then((r) => r.json())
      .then((data) => data.ok && setCatalog(data.catalog))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!account) return;
    apiFetch(`${API_URL}/nfts/${account}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setUnlocked(new Set(data.nfts.map((n: { nft_key: string }) => n.nft_key)));
      })
      .catch(() => {});
  }, [account]);

  const filtered = filter === "all" ? catalog : catalog.filter((n) => n.rarity === filter);
  const ownedCount = useMemo(() => catalog.filter((n) => unlocked.has(n.key)).length, [catalog, unlocked]);

  // Progress is measured against what a player can actually earn, not the full
  // catalog — 10 of the 23 listed NFTs have unlock conditions that are not
  // implemented, so counting them would cap everyone below 100% forever.
  // `obtainable === undefined` means an older server that doesn't send the flag;
  // treat those as obtainable so a lagging API degrades to the old behaviour.
  const obtainable = useMemo(() => catalog.filter((n) => n.obtainable !== false), [catalog]);
  const lockedForNow = catalog.length - obtainable.length;
  const pct = obtainable.length ? Math.round((ownedCount / obtainable.length) * 100) : 0;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-bold neon-glow">NFT Gallery</h1>
        <p className="text-sm text-gray-400 mt-1">
          Earn achievement NFTs by playing{obtainable.length ? ` — ${obtainable.length} to collect` : ""}.
        </p>
        {lockedForNow > 0 && (
          <p className="text-xs text-gray-500 mt-1">
            {lockedForNow} more are designed but not yet earnable — they are shown greyed out below.
          </p>
        )}
      </div>

      {/* Collection progress */}
      <div className="mb-6 rounded-xl border border-gray-700/40 bg-[var(--bg-card)] p-4">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium text-gray-300">Your collection</span>
          <span className="font-bold text-green-400">
            {ownedCount} / {obtainable.length || "…"}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-800">
          <div className="h-full rounded-full bg-gradient-to-r from-green-500 to-cyan-500 transition-all duration-500" style={{ width: `${pct}%` }} />
        </div>
        {!account && <p className="mt-2 text-[11px] text-gray-500">Play as a guest or connect a wallet to start earning.</p>}
      </div>

      {/* Rarity filter */}
      <div className="mb-6 flex flex-wrap gap-2">
        {["all", ...RARITY_ORDER].map((r) => (
          <button
            key={r}
            onClick={() => setFilter(r)}
            className={cn(
              "rounded border px-3 py-1 text-xs font-medium capitalize transition-colors",
              filter === r ? "border-green-500/30 bg-green-600/20 text-green-400" : "border-transparent text-gray-500 hover:text-gray-300",
            )}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Collection wall */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
        {filtered.map((nft) => {
          const owned = unlocked.has(nft.key);
          const earnable = nft.obtainable !== false;
          const rar = RARITY[nft.rarity] ?? RARITY.common;
          return (
            <div
              key={nft.key}
              className={cn(
                "rounded-xl border bg-[var(--bg-card)] p-3 text-center transition-all",
                owned ? cn(rar.border, rar.glow && `shadow-md ${rar.glow}`) : "border-gray-800/80",
              )}
            >
              <div className={cn("relative mb-3 flex aspect-square w-full items-center justify-center rounded-lg", rar.tint)}>
                <span className={cn("text-5xl leading-none", !owned && "opacity-25 grayscale")}>{nft.emoji}</span>
                {!owned && <span className="absolute right-1.5 top-1.5 text-xs opacity-70">🔒</span>}
              </div>
              <div className={cn("mb-1 text-sm font-bold", !owned && "text-gray-400")}>{nft.name}</div>
              <div className={cn("mb-1 text-[10px] font-medium uppercase tracking-wider", rar.text, !owned && "opacity-70")}>{rar.label}</div>
              <p className="text-[10px] leading-snug text-gray-500">{nft.description}</p>
              {/* Never label an unimplemented NFT merely "Locked" — that reads as
                  "keep playing and you'll get it", which is not true today. */}
              <div
                className={cn(
                  "mt-2 text-[10px] font-medium",
                  owned ? "text-green-400" : earnable ? "text-gray-400" : "text-yellow-600/80",
                )}
              >
                {owned ? "✓ Collected" : earnable ? "Locked" : "Not yet earnable"}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
