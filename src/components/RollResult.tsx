"use client";
import type { RollOutcome } from "@/lib/types";
import { CELL_CONFIG } from "@/lib/game-config";
import { cn } from "@/lib/utils";

interface RollResultProps {
  outcome: RollOutcome | null;
}

export default function RollResult({ outcome }: RollResultProps) {
  if (!outcome) return null;

  const config = CELL_CONFIG[outcome.cellType];
  const isPositive = outcome.scoreChange >= 0;
  const hasLines = outcome.lines && outcome.lines.length > 0;
  const hasPatterns = outcome.patterns && outcome.patterns.length > 0;
  const hasCombo = outcome.comboMultiplier > 1;

  return (
    // Deliberately NOT a live region. This component unmounts between rolls, and
    // a region that appears at the same moment as its content is unreliable —
    // most AT only announces changes to regions already in the accessibility
    // tree. The announcement is made by the always-mounted announcer in
    // app/play/page.tsx instead; this is the visual presentation.
    <div className="space-y-2 animate-slide-up">
      {/* Main result */}
      <div className={cn(
        "rounded-lg border p-3 text-center text-sm",
        "bg-[var(--bg-card)]",
        hasCombo ? "border-yellow-500/50 shadow-lg shadow-yellow-500/10" :
        isPositive ? "border-green-500/30" : "border-red-500/30"
      )}>
        <div className="flex items-center justify-center gap-2 mb-1">
          <span className="text-lg">{config.emoji}</span>
          <span className={cn("font-bold", config.color)}>{outcome.message}</span>
        </div>
        <div className="flex justify-center gap-4 text-xs text-gray-400">
          {outcome.scoreChange !== 0 && (
            <span className={isPositive ? "text-green-400" : "text-red-400"}>
              {isPositive ? "+" : ""}{outcome.scoreChange} pts
            </span>
          )}
          {outcome.xpEarned > 0 && (
            <span className="text-cyan-400">+{outcome.xpEarned} XP</span>
          )}
          <span>Dice: {outcome.dice.label} ({outcome.dice.value})</span>
        </div>
        {outcome.pityBonusXp > 0 && (
          <div className="text-xs text-purple-400 mt-1">Pity bonus: +{outcome.pityBonusXp} XP</div>
        )}
      </div>

      {/* Line bonuses */}
      {hasLines && (
        <div className="rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-3 text-center animate-combo-flash">
          <div className="flex items-center justify-center gap-2 text-yellow-400 font-bold text-sm">
            <span>&#x1F389;</span>
            {outcome.lines.map((l, i) => (
              <span key={i}>{l.label}</span>
            ))}
            {hasCombo && <span className="text-lg">COMBO x{outcome.comboMultiplier}!</span>}
          </div>
          <div className="text-xs text-yellow-300/70 mt-1">
            Line bonus: +{outcome.lineBonusScore} pts, +{outcome.lineBonusXp} XP
          </div>
        </div>
      )}

      {/* Pattern bonuses */}
      {hasPatterns && outcome.patterns.map((p, i) => (
        <div key={i} className="rounded-lg border border-purple-500/40 bg-purple-500/5 p-3 text-center">
          <div className="text-purple-400 font-bold text-sm">
            {p.emoji} {p.label}
          </div>
          <div className="text-xs text-purple-300/70">+{p.reward} pts, +{p.xp} XP</div>
        </div>
      ))}

      {/* Near misses */}
      {outcome.nearMisses && outcome.nearMisses.length > 0 && (
        <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-2 text-center text-xs text-cyan-400">
          Almost there! {outcome.nearMisses.map((nm) => nm.type).join(", ")} — 1 cell away!
        </div>
      )}
    </div>
  );
}
