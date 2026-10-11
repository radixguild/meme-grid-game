"use client";
import { useMemo } from "react";

const COLORS = ["#39ff14", "#bf00ff", "#ff006e", "#ffe600", "#3b82f6", "#00e5ff", "#f97316"];

interface ConfettiProps {
  count?: number;
}

export default function Confetti({ count = 50 }: ConfettiProps) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        left: `${Math.random() * 100}%`,
        delay: `${Math.random() * 2}s`,
        duration: `${1.5 + Math.random() * 2}s`,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        size: Math.random() * 10 + 4,
        rotation: Math.random() * 360,
      })),
    [count]
  );

  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden z-50">
      {pieces.map((p) => (
        <span
          key={p.id}
          className="absolute top-0 animate-confetti-fall"
          style={{
            left: p.left,
            animationDelay: p.delay,
            animationDuration: p.duration,
            backgroundColor: p.color,
            width: p.size,
            height: p.size,
            borderRadius: Math.random() > 0.5 ? "50%" : "2px",
            transform: `rotate(${p.rotation}deg)`,
          }}
        />
      ))}
    </div>
  );
}
