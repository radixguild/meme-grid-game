"use client";
import { STREAK_MILESTONES } from "@/lib/game-config";

interface StreakBannerProps {
  streak: number;
  longestStreak: number;
}

export default function StreakBanner({ streak, longestStreak }: StreakBannerProps) {
  if (streak <= 0) return null;

  const nextMilestone = STREAK_MILESTONES.find((m) => m.days > streak);
  const currentMilestone = [...STREAK_MILESTONES].reverse().find((m) => m.days <= streak);

  return (
    // Single line on phones. This was a two-line-each-side card costing ~110px of
    // an 812px viewport, directly above the board it was pushing down. The streak
    // is worth showing; it is not worth more room than eight rows of the game.
    <div className="bg-gradient-to-r from-orange-500/10 to-yellow-500/10 border border-orange-500/20 rounded-lg px-3 py-1.5 sm:p-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <span className="text-base sm:text-2xl leading-none">{streak >= 7 ? "\ud83d\udd25" : "\u2b50"}</span>
        <div className="min-w-0">
          <div className="font-bold text-xs sm:text-sm text-orange-400 leading-tight">
            {streak} Day Streak!
          </div>
          <div className="hidden sm:block text-[10px] text-gray-500">
            {currentMilestone ? currentMilestone.label : "Keep playing!"}
            {longestStreak > streak && ` | Best: ${longestStreak}`}
          </div>
        </div>
      </div>
      {nextMilestone && (
        <div className="text-right min-w-0">
          <div className="text-[10px] text-gray-500 truncate">Next: {nextMilestone.label}</div>
          <div className="text-[10px] text-yellow-400 truncate">{nextMilestone.reward}</div>
        </div>
      )}
    </div>
  );
}
