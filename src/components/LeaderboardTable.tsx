"use client";
import { useEffect, useMemo, useState } from "react";
import { API_URL } from "@/lib/constants";
import { truncateAddress } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { LeaderboardEntry } from "@/lib/types";
import { apiFetch } from "@/lib/api";
import { useWallet } from "@/hooks/useWallet";

export default function LeaderboardTable() {
  const { account } = useWallet();
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [sort, setSort] = useState("xp");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch(`${API_URL}/leaderboard?sort=${sort}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setEntries(data.entries);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [sort]);

  // A board opened but never rolled still creates a player row, so the tail of
  // the list was accounts sitting on 0 XP / 0 points / 0 grids — nothing to rank
  // and nothing to read. Rank the players who have actually done the thing being
  // ranked. Ranks are computed after filtering so #1..#n stay contiguous.
  const ranked = useMemo(() => {
    const value = (e: LeaderboardEntry) =>
      sort === "score" ? e.best_score : sort === "grids" ? e.total_boards : e.xp;
    return entries.filter((e) => value(e) > 0);
  }, [entries, sort]);

  const hiddenCount = entries.length - ranked.length;
  const myRank = account ? ranked.findIndex((e) => e.radix_address === account) : -1;

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 overflow-hidden">
      <div className="flex gap-1 p-3 border-b border-gray-700/40">
        {["xp", "score", "grids"].map((s) => (
          <button
            key={s}
            onClick={() => setSort(s)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              sort === s ? "bg-green-600/20 text-green-400 border border-green-500/30" : "text-gray-500 hover:text-gray-300"
            }`}
          >
            {s === "xp" ? "Level" : s === "score" ? "Best Score" : "Grids"}
          </button>
        ))}
      </div>
      <div className="divide-y divide-gray-800/50">
        {loading ? (
          <div className="p-6 text-center text-gray-500">Loading...</div>
        ) : ranked.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            Nobody has scored here yet — be first.
          </div>
        ) : (
          ranked.map((entry, i) => (
            <div
              key={entry.radix_address}
              className={cn(
                "flex items-center gap-3 px-4 py-2 transition-colors",
                i === myRank
                  ? "bg-green-600/10 ring-1 ring-inset ring-green-500/30"
                  : "hover:bg-[var(--bg-card-hover)]"
              )}
            >
              <span className="text-sm font-bold text-gray-500 w-6">#{i + 1}</span>
              <span>{entry.level_emoji}</span>
              <div className="flex-1 min-w-0">
                <span className="text-sm font-medium truncate block">
                  {entry.display_name || truncateAddress(entry.radix_address)}
                  {i === myRank && <span className="ml-2 text-[10px] font-bold text-green-400">YOU</span>}
                </span>
                <span className="text-xs text-gray-500">{entry.level_name}</span>
              </div>
              <div className="text-right">
                <div className="text-sm font-bold text-green-400">
                  {sort === "score" ? entry.best_score : sort === "grids" ? entry.total_boards : entry.xp.toLocaleString()}
                </div>
                <div className="text-[10px] text-gray-500">
                  {sort === "score" ? "pts" : sort === "grids" ? "grids" : "XP"}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
      {!loading && (hiddenCount > 0 || (account && myRank === -1)) && (
        <div className="border-t border-gray-800/50 px-4 py-2 text-[11px] text-gray-500">
          {account && myRank === -1
            ? "You're not on this board yet — finish a roll to appear."
            : `${hiddenCount} player${hiddenCount === 1 ? "" : "s"} not ranked yet.`}
        </div>
      )}
    </div>
  );
}
