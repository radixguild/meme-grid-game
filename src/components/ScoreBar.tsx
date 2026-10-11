"use client";
import { useState, useEffect } from "react";
import { formatMeme } from "@/lib/utils";
import type { Player, Board } from "@/lib/types";

interface ScoreBarProps {
  player: Player;
  board: Board | null;
}

export default function ScoreBar({ player, board }: ScoreBarProps) {
  const [scoreAnim, setScoreAnim] = useState(false);
  const [balanceAnim, setBalanceAnim] = useState(false);

  // Trigger animation on score change
  const score = board?.score ?? 0;
  const balance = player.meme_balance;
  useEffect(() => { setScoreAnim(true); const t = setTimeout(() => setScoreAnim(false), 400); return () => clearTimeout(t); }, [score]);
  useEffect(() => { setBalanceAnim(true); const t = setTimeout(() => setBalanceAnim(false), 400); return () => clearTimeout(t); }, [balance]);

  return (
    <div className="grid grid-cols-4 gap-1.5 sm:gap-3">
      <StatCard label="ROLLS Balance" value={formatMeme(player.meme_balance)} emoji="💰" color="text-yellow-400" pop={balanceAnim} />
      <StatCard label="Score" value={board ? board.score.toString() : "-"} emoji="🎯" color="text-green-400" pop={scoreAnim} />
      <StatCard label="Extra Turns" value={board ? board.extra_turns.toString() : "0"} emoji="🎁" color="text-cyan-400" />
      <StatCard label="Wild Cards" value={board ? board.wild_cards.toString() : "0"} emoji="🃏" color="text-purple-400" />
    </div>
  );
}

// Compact on phones, unchanged from sm: up. These four cards used to be a 2x2 of
// tall cards costing roughly 400px on a 812px viewport, which pushed the board —
// the actual game — almost entirely below the fold. A player had to scroll past
// their own stats to reach the thing the stats are about.
function StatCard({ label, value, emoji, color, pop }: { label: string; value: string; emoji: string; color: string; pop?: boolean }) {
  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700/40 px-1 py-1.5 sm:p-3 text-center">
      <div className="text-xs sm:text-lg leading-none">{emoji}</div>
      <div className={`text-base sm:text-xl font-bold leading-tight ${color} ${pop ? "animate-score-pop" : ""}`}>{value}</div>
      <div className="text-[8px] sm:text-[10px] text-gray-500 uppercase tracking-wide sm:tracking-wider leading-tight">{label}</div>
    </div>
  );
}
