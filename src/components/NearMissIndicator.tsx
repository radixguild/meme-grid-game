"use client";

interface NearMissIndicatorProps {
  nearMisses: Array<{ type: string; remaining: { row: number; col: number } }>;
}

export default function NearMissIndicator({ nearMisses }: NearMissIndicatorProps) {
  if (!nearMisses || nearMisses.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2 justify-center">
      {nearMisses.map((nm, i) => (
        <div
          key={i}
          className="animate-pulse-glow px-3 py-1 rounded-full text-xs font-medium bg-cyan-500/10 border border-cyan-500/30 text-cyan-400"
        >
          {nm.type} — 1 away!
        </div>
      ))}
    </div>
  );
}
