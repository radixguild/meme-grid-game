"use client";
import type { Player } from "@/lib/types";
import { LEVELS } from "@/lib/game-config";

interface LevelProgressProps {
  player: Player;
}

export default function LevelProgress({ player }: LevelProgressProps) {
  const currentLevelXp = LEVELS.find((l) => l.level === player.level)?.xp ?? 0;
  const span = player.next_level_xp ? player.next_level_xp - currentLevelXp : 1;
  const progress = player.next_level_xp
    ? ((player.xp - currentLevelXp) / span) * 100
    : 100;

  const clampedProgress = Math.max(0, Math.min(100, progress));

  return (
    <div className="bg-[var(--bg-card)] rounded-lg border border-gray-700/40 p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">{player.level_emoji}</span>
          <span className="font-bold text-sm">{player.level_name}</span>
          <span className="text-xs text-gray-500">Lv.{player.level}</span>
        </div>
        <span className="text-xs text-gray-400">
          {player.xp.toLocaleString()} XP
          {player.next_level_xp && ` / ${player.next_level_xp.toLocaleString()}`}
        </span>
      </div>
      <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-green-500 to-cyan-400 rounded-full transition-all duration-500"
          style={{ width: `${clampedProgress}%` }}
        />
      </div>
    </div>
  );
}
