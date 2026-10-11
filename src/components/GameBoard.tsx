"use client";
import { useEffect, useRef } from "react";
import type { Cell } from "@/lib/types";
import { GRID_SIZE } from "@/lib/constants";
import GameCell from "./GameCell";

interface GameBoardProps {
  grid: Cell[][];
  lastHitRow?: number;
  lastHitCol?: number;
  wildMode: boolean;
  xRayActive?: boolean;
  onWildClick?: (row: number, col: number) => void;
}

export default function GameBoard({ grid, lastHitRow, lastHitCol, wildMode, xRayActive, onWildClick }: GameBoardProps) {
  const gridRef = useRef<HTMLDivElement>(null);

  // Entering wild mode is the one action that turns the 64 cells into operable
  // controls. The grid sits EARLIER in DOM order than the Wild Card button that
  // enables it, so a keyboard user had to Shift+Tab backwards past the dice and
  // the roll result to reach the controls they had just switched on, with no cue
  // that this was needed. Move focus to the first targetable cell instead.
  useEffect(() => {
    if (!wildMode) return;
    const first = gridRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])");
    first?.focus();
  }, [wildMode]);
  // Count completed cells per row/col for near-completion highlights
  const completedCells = grid.flat().filter((c) => c.completed).length;
  const totalCells = GRID_SIZE * GRID_SIZE;
  const progressPercent = Math.round((completedCells / totalCells) * 100);

  return (
    // p-1.5 below sm: 8 columns cannot reach the 44px tap-target minimum on a
    // 375px screen no matter what (8x44 plus gaps overflows the viewport), but
    // the card padding and gaps were spending 66px of the 343px available and
    // leaving ~35px cells. Trimming both to phone sizes buys back ~5px per cell,
    // which matters most in wild-card mode, where all 64 become real tap targets.
    <div className="neon-border rounded-xl p-1.5 sm:p-3 bg-[var(--bg-card)] max-w-[640px] mx-auto">
      {/* Progress bar above grid */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-green-500 to-cyan-400 rounded-full transition-all duration-500"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
        <span className="text-[10px] text-gray-500 shrink-0">{progressPercent}%</span>
      </div>

      {/* Grid */}
      <div
        ref={gridRef}
        role={wildMode ? "group" : undefined}
        aria-label={wildMode ? "Choose a cell to complete with your wild card" : undefined}
        className="grid gap-1 sm:gap-1.5"
        style={{ gridTemplateColumns: `repeat(${GRID_SIZE}, minmax(0, 72px))` }}
      >
        {grid.map((row, r) =>
          row.map((cell, c) => (
            <GameCell
              key={`${r}-${c}`}
              cell={cell}
              row={r}
              col={c}
              isLastHit={r === lastHitRow && c === lastHitCol}
              wildMode={wildMode}
              xRayActive={xRayActive}
              onWildClick={onWildClick}
            />
          ))
        )}
      </div>
    </div>
  );
}
