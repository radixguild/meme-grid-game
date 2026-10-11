"use client";
import { useState, useEffect } from "react";
import { DICE_FACES } from "@/lib/game-config";
import { cn } from "@/lib/utils";

interface DiceRollerProps {
  onRoll: () => void;
  rolling: boolean;
  lastValue?: number;
  disabled: boolean;
  cost: number;
  hasExtra: boolean;
}

export default function DiceRoller({ onRoll, rolling, lastValue, disabled, cost, hasExtra }: DiceRollerProps) {
  const [displayFace, setDisplayFace] = useState(0);

  useEffect(() => {
    if (!rolling) return;
    const interval = setInterval(() => {
      setDisplayFace(Math.floor(Math.random() * 6));
    }, 80);
    return () => clearInterval(interval);
  }, [rolling]);

  const face = rolling ? DICE_FACES[displayFace] : lastValue ? DICE_FACES[lastValue - 1] : DICE_FACES[0];

  return (
    <div className="flex flex-col items-center gap-3">
      {/* Decorative twin of the labelled button below: same onRoll, same disabled
          state, no information of its own. Naming it would make screen readers
          announce the roll action twice; hiding it announces it once, correctly. */}
      <button
        onClick={onRoll}
        disabled={disabled || rolling}
        aria-hidden="true"
        tabIndex={-1}
        className={cn(
          "text-6xl p-4 rounded-2xl transition-all duration-200",
          "bg-[var(--bg-card)] border-2",
          rolling && "animate-dice-tumble border-yellow-500/60",
          !rolling && !disabled && "border-[var(--neon-green)]/40 hover:border-[var(--neon-green)] hover:shadow-lg hover:shadow-green-500/20 cursor-pointer",
          disabled && "opacity-40 cursor-not-allowed border-gray-700",
        )}
      >
        {face}
      </button>
      <div className="text-center">
        <button
          onClick={onRoll}
          disabled={disabled || rolling}
          className={cn(
            "px-6 py-2 rounded-lg font-bold text-sm transition-all",
            !disabled && "bg-gradient-to-r from-green-600 to-cyan-600 hover:from-green-500 hover:to-cyan-500 text-white shadow-lg shadow-green-500/20",
            disabled && "bg-gray-800 text-gray-500 cursor-not-allowed",
          )}
        >
          {/* MobileRollBar already pluralises; this one always said "1 ROLLS". */}
          {rolling ? "Rolling..." : hasExtra ? "ROLL (Free!)" : `ROLL (${cost} ${cost === 1 ? "ROLL" : "ROLLS"})`}
        </button>
      </div>
    </div>
  );
}
