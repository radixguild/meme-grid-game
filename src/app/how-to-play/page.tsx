"use client";
import Link from "next/link";
import { CELL_CONFIG, LEVELS, POWER_UPS, STREAK_MILESTONES } from "@/lib/game-config";
import type { CellType } from "@/lib/types";
import { BOARD_COST_LABEL, FREE_STARTING_ROLLS } from "@/lib/constants";

export default function HowToPlayPage() {
  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-8 py-4">
      <h1 className="text-3xl font-bold neon-glow text-center">How To Play</h1>

      {/* Quick start */}
      <Section title="Quick Start" emoji="&#x1F680;">
        <ol className="space-y-3 text-sm text-gray-300">
          <li className="flex gap-3"><Num n={1} /> Connect your Radix wallet</li>
          <li className="flex gap-3"><Num n={2} /> You get <span className="text-yellow-400 font-bold">{FREE_STARTING_ROLLS} free ROLLS</span> to try it out</li>
          <li className="flex gap-3"><Num n={3} /> Start a board &mdash; {BOARD_COST_LABEL}</li>
          <li className="flex gap-3"><Num n={4} /> Roll dice (1 ROLLS per roll) to hit random cells</li>
          <li className="flex gap-3"><Num n={5} /> Complete all 64 cells to win the board</li>
          <li className="flex gap-3"><Num n={6} /> Earn XP, level up, unlock NFTs!</li>
        </ol>
      </Section>

      {/* The Grid */}
      <Section title="The 8x8 Grid" emoji="&#x1F3AF;">
        <p className="text-sm text-gray-400 mb-4">
          {/* The threshold is 1 or 2 — `pickThreshold()` in server/src/game/grid.ts
              returns nothing else. This line has now been wrong twice, as "3-6" and
              then as "2-5"; both invented an upper half of a range that does not
              exist, and both made a board look ~2.5x longer than it is. */}
          Each board is an 8x8 grid of 64 hidden cells. Each cell has a <strong>type</strong> (determines its reward)
          and a <strong>hit threshold</strong> — 1 hit 40% of the time, 2 hits the other 60%. When you roll, a
          random incomplete cell gets hit, so a whole board takes about 100 rolls.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(Object.entries(CELL_CONFIG) as [CellType, typeof CELL_CONFIG[CellType]][]).map(([type, cfg]) => (
            <div key={type} className="bg-gray-900/50 rounded-lg border border-gray-800/50 p-3 text-center">
              <div className="text-2xl mb-1">{cfg.emoji}</div>
              <div className={`text-xs font-bold ${cfg.color}`}>{cfg.label}</div>
              <div className="text-[10px] text-gray-500 mt-1">
                {type === "normal" && "+10 pts, +10 XP"}
                {type === "double_score" && "+20 pts, 2x score"}
                {type === "extra_turn" && "+10 pts, free roll!"}
                {type === "wild" && "+15 pts, pick a cell"}
                {type === "rug_pull" && "-15 pts, ouch"}
                {type === "pepe_bonus" && "+10 pts, +25 XP"}
                {type === "otter" && "+15 pts, +30 XP — Radix mascot!"}
                {type === "diamond" && "+30 pts, jackpot!"}
                {type === "moon" && "+50 pts, +100 XP!"}
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Line Bonuses */}
      <Section title="Line & Combo Bonuses" emoji="&#x1F4A5;">
        <p className="text-sm text-gray-400 mb-4">
          Complete full rows, columns, or diagonals for bonus points! Multiple lines at once trigger a <strong>combo multiplier</strong>.
        </p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <BonusRow label="Row / Column" reward="+25 pts, +30 XP" />
          <BonusRow label="Diagonal" reward="+50 pts, +60 XP" />
          <BonusRow label="2 lines combo" reward="x2.5 multiplier!" />
          <BonusRow label="3+ lines combo" reward="x4-10 multiplier!" />
          <BonusRow label="Four Corners" reward="+30 pts" />
          <BonusRow label="Full Border" reward="+100 pts" />
          <BonusRow label="X Pattern" reward="+80 pts" />
          <BonusRow label="BLACKOUT" reward="+500 pts!!!" />
        </div>
      </Section>

      {/* Power-ups */}
      <Section title="Power-Ups" emoji="&#x26A1;">
        <p className="text-sm text-gray-400 mb-4">
          Buy power-ups with ROLLS or earn them through streaks. Use them strategically during gameplay.
        </p>
        <div className="space-y-2">
          {POWER_UPS.map((pu) => (
            <div key={pu.type} className="flex items-center gap-3 bg-gray-900/50 rounded-lg border border-gray-800/50 p-3">
              <span className="text-2xl">{pu.emoji}</span>
              <div className="flex-1">
                <div className="text-sm font-bold">{pu.name}</div>
                <div className="text-[10px] text-gray-500">{pu.description}</div>
              </div>
              <div className="text-xs text-yellow-400 font-bold">{pu.cost} ROLLS</div>
            </div>
          ))}
        </div>
      </Section>

      {/* Always win */}
      <Section title="You Always Win Something" emoji="&#x2728;">
        <div className="space-y-2 text-sm text-gray-300">
          <p><strong className="text-green-400">Every roll gives XP</strong> — even misses give minimum 1 XP plus dice bonus.</p>
          <p><strong className="text-purple-400">Pity system</strong> — every 5 rolls without completing a cell adds +10 bonus XP to your next completion.</p>
          <p><strong className="text-cyan-400">Near-miss alerts</strong> — when a row/column is 1 cell away, you'll see a pulsing indicator.</p>
          <p><strong className="text-yellow-400">Rug pulls give XP too</strong> — they hurt on score, but always award minimum +2 XP.</p>
        </div>
      </Section>

      {/* Streaks */}
      <Section title="Daily Streaks" emoji="&#x1F525;">
        <p className="text-sm text-gray-400 mb-4">
          Play every day for escalating rewards. Miss a day? You lose 1 streak level — not a full reset.
        </p>
        <div className="space-y-1">
          {STREAK_MILESTONES.map((m) => (
            <div key={m.days} className="flex justify-between text-xs bg-gray-900/30 rounded px-3 py-2">
              <span className="text-gray-300">{m.label}</span>
              <span className="text-yellow-400">{m.reward}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Levels */}
      <Section title="Level Progression" emoji="&#x1F4C8;">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {LEVELS.map((l) => (
            <div key={l.level} className="text-center bg-gray-900/50 rounded-lg border border-gray-800/50 p-2">
              <div className="text-lg">{l.emoji}</div>
              <div className="text-xs font-bold">{l.name}</div>
              <div className="text-[10px] text-gray-500">{l.xp.toLocaleString()} XP</div>
            </div>
          ))}
        </div>
      </Section>

      {/* CTA */}
      <div className="text-center py-6">
        <Link
          href="/play"
          className="px-8 py-3 rounded-xl font-bold text-lg bg-gradient-to-r from-green-600 to-cyan-600 hover:from-green-500 hover:to-cyan-500 text-white shadow-lg shadow-green-500/20 transition-all"
        >
          Start Playing
        </Link>
      </div>
    </div>
  );
}

function Section({ title, emoji, children }: { title: string; emoji: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 p-5">
      <h2 className="text-lg font-bold mb-4 flex items-center gap-2">
        <span dangerouslySetInnerHTML={{ __html: emoji }} />
        {title}
      </h2>
      {children}
    </div>
  );
}

function Num({ n }: { n: number }) {
  return (
    <span className="w-6 h-6 rounded-full bg-green-600/20 text-green-400 text-xs font-bold flex items-center justify-center shrink-0">
      {n}
    </span>
  );
}

function BonusRow({ label, reward }: { label: string; reward: string }) {
  return (
    <div className="flex justify-between bg-gray-900/30 rounded px-3 py-2">
      <span className="text-gray-300">{label}</span>
      <span className="text-yellow-400">{reward}</span>
    </div>
  );
}
