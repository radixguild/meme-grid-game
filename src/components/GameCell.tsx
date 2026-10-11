"use client";
import { useState, useEffect } from "react";
import type { Cell } from "@/lib/types";
import { CELL_CONFIG } from "@/lib/game-config";
import { cn } from "@/lib/utils";

interface GameCellProps {
  cell: Cell;
  row: number;
  col: number;
  isLastHit: boolean;
  wildMode: boolean;
  xRayActive?: boolean;
  onWildClick?: (row: number, col: number) => void;
}

export default function GameCell({ cell, row, col, isLastHit, wildMode, xRayActive, onWildClick }: GameCellProps) {
  const [animating, setAnimating] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const config = cell.type ? CELL_CONFIG[cell.type] : null;

  useEffect(() => {
    if (isLastHit) {
      setAnimating(true);
      if (cell.completed) setJustCompleted(true);
      const timer = setTimeout(() => { setAnimating(false); setJustCompleted(false); }, 600);
      return () => clearTimeout(timer);
    }
  }, [isLastHit, cell.hits, cell.completed]);

  const canTarget = wildMode && !cell.completed;
  const progress = cell.threshold != null && cell.threshold > 0 ? (cell.hits / cell.threshold) * 100 : 0;
  const cellBg = cell.completed ? "bg-gradient-to-br from-gray-800/60 to-gray-900/80" : cell.hits > 0 ? "bg-gradient-to-br from-gray-800/40 to-gray-900/60" : "bg-[var(--bg-card)]";

  return (
    <button onClick={() => canTarget && onWildClick?.(row, col)} disabled={!canTarget} aria-label={
      cell.completed && config
        ? `Row ${row + 1} column ${col + 1}: ${config.label}, complete`
        : cell.hits > 0 && cell.threshold != null
          ? `Row ${row + 1} column ${col + 1}: ${cell.hits} of ${cell.threshold} hits`
          : `Row ${row + 1} column ${col + 1}: unrevealed`
    } className={cn(
      "relative aspect-square rounded-lg border transition-all duration-200 flex flex-col items-center justify-center gap-0.5 overflow-hidden", cellBg,
      cell.completed ? `border-gray-600/30 ${config?.glowColor ?? ""} shadow-md` : "border-gray-700/30 hover:border-gray-600/50",
      animating && !cell.completed && "animate-cell-hit", justCompleted && "animate-cell-complete",
      animating && cell.type === "rug_pull" && cell.completed && "animate-rug-shake",
      // Wild mode turns all 64 cells into tap targets on a ~40px grid, so the
      // targetable state needs to be unmissable rather than a thin ring.
      canTarget && "ring-2 ring-purple-400 bg-purple-500/15 cursor-pointer hover:ring-purple-300 hover:bg-purple-500/25", !canTarget && !cell.completed && "cursor-default",
    )}>
      {/* No per-tile label. The artwork or emoji fills the square and the legend below
          the grid carries the naming — on a phone an 8px caption bar over a 40px tile
          only crowds the thing it is captioning, and every type is already listed
          once, legibly, in the legend. `aria-label` on the button keeps it announced
          to screen readers, which a decorative caption never did anyway. */}
      {cell.completed && config && (config.image ? <div className={cn("absolute inset-0 bg-cover bg-center transition-transform", justCompleted && "scale-110")} style={{ backgroundImage: `url(${config.image})` }} /> : <><div className={cn("absolute inset-0", config.tint)} /><span className={cn("relative text-3xl sm:text-4xl leading-none transition-transform", justCompleted && "scale-125")}>{config.emoji}</span></>)}
      {!cell.completed && xRayActive && config && (config.image ? <div className="absolute inset-0 bg-cover bg-center opacity-40" style={{ backgroundImage: `url(${config.image})` }} /> : <><div className={cn("absolute inset-0 opacity-50", config.tint)} /><span className="relative text-2xl sm:text-3xl leading-none opacity-45">{config.emoji}</span></>)}
      {!cell.completed && !xRayActive && <>{cell.hits > 0 && cell.threshold != null ? <><span className="text-cyan-500/70 text-lg sm:text-xl leading-none">◐</span><span className="text-[9px] sm:text-[11px] text-cyan-400 leading-none font-medium">{cell.hits}/{cell.threshold}</span></> : <span className="text-gray-400 text-xl sm:text-2xl leading-none">?</span>}</>}
      {!cell.completed && cell.hits > 0 && cell.threshold != null && <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-cyan-500/15 to-transparent transition-all duration-500" style={{ height: `${progress}%` }} />}
      {justCompleted && <div className="absolute inset-0 bg-white/10 rounded-lg animate-pulse-glow" />}
    </button>
  );
}
