"use client";
import { useEffect, useState } from "react";
import type { RollOutcome } from "@/lib/types";
import { DICE_FACES } from "@/lib/game-config";
import { cn } from "@/lib/utils";

interface MobileRollBarProps {
  onRoll: () => void;
  rolling: boolean;
  canRoll: boolean;
  cost: number;
  hasExtra: boolean;
  outcome: RollOutcome | null;
  wildMode: boolean;
  onCancelModes: () => void;
}

/**
 * Thumb-reachable roll control pinned to the bottom of the viewport on
 * mobile, so you can roll repeatedly while the board stays in view instead
 * of scrolling down to the side panel. Hidden on lg+ (desktop uses DiceRoller).
 */
export default function MobileRollBar({
  onRoll,
  rolling,
  canRoll,
  cost,
  hasExtra,
  outcome,
  wildMode,
  onCancelModes,
}: MobileRollBarProps) {
  const [face, setFace] = useState(0);

  useEffect(() => {
    if (!rolling) return;
    const id = setInterval(() => setFace(Math.floor(Math.random() * 6)), 80);
    return () => clearInterval(id);
  }, [rolling]);

  const glyph = rolling ? DICE_FACES[face] : outcome ? DICE_FACES[outcome.dice.value - 1] : DICE_FACES[0];
  const selecting = wildMode;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-gray-700/60 bg-[var(--bg-card)]/95 px-4 pt-2 pb-[calc(0.6rem+env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
      {selecting ? (
        <div className="flex h-14 items-center justify-between">
          <span className="text-sm font-medium text-yellow-400">
            🃏 Tap a cell to place your wild
          </span>
          <button onClick={onCancelModes} className="rounded-lg px-4 py-3 text-xs text-gray-400 active:text-white">
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className={cn("shrink-0 text-3xl leading-none", rolling && "animate-dice-tumble")}>{glyph}</span>
          {outcome && (
            <span className="min-w-0 truncate text-xs text-gray-400">
              {outcome.scoreChange !== 0 && (
                <span className={outcome.scoreChange >= 0 ? "font-medium text-green-400" : "font-medium text-red-400"}>
                  {outcome.scoreChange >= 0 ? "+" : ""}
                  {outcome.scoreChange} pts
                </span>
              )}
              {outcome.xpEarned > 0 && <span className="font-medium text-cyan-400"> +{outcome.xpEarned} XP</span>}
            </span>
          )}
          <button
            onClick={onRoll}
            disabled={!canRoll || rolling}
            className={cn(
              "ml-auto h-14 min-w-[45%] rounded-xl px-6 text-base font-bold transition-transform",
              canRoll && !rolling
                ? "bg-gradient-to-r from-green-600 to-cyan-600 text-white shadow-lg shadow-green-500/25 active:scale-95"
                : "cursor-not-allowed bg-gray-800 text-gray-500",
            )}
          >
            {rolling ? "Rolling…" : hasExtra ? "ROLL · Free" : `ROLL · ${cost} ${cost === 1 ? "ROLL" : "ROLLS"}`}
          </button>
        </div>
      )}
    </div>
  );
}
