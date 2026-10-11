"use client";

const PHRASES = [
  "gm", "wagmi", "wen moon", "ngmi", "probably nothing", "ser",
  "fren", "based", "touch grass", "lfg", "diamond hands", "wen lambo",
  "to the moon", "degen life", "ape in", "few understand", "gn",
  "hodl", "rekt", "chad", "cope", "seethe", "bullish",
];

export default function MemeTicker() {
  // Double the phrases for seamless loop
  const items = [...PHRASES, ...PHRASES];

  return (
    <div className="overflow-hidden py-2 border-y border-gray-800/30 bg-gray-900/20">
      <div className="flex gap-6 animate-ticker whitespace-nowrap">
        {items.map((phrase, i) => (
          <span key={i} className="text-xs text-gray-400 font-mono uppercase tracking-widest">
            {phrase} <span className="text-green-600/40">*</span>
          </span>
        ))}
      </div>
    </div>
  );
}
