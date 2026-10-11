"use client";
import Link from "next/link";
import { useWallet } from "@/hooks/useWallet";
import ConnectButton from "@/components/ConnectButton";
import { useEffect, useState } from "react";
import { API_URL, OBTAINABLE_NFT_COUNT, BOARD_COST_LABEL, FREE_STARTING_ROLLS } from "@/lib/constants";
import { CELL_TYPE_COUNT } from "@/lib/game-config";
import MemeTicker from "@/components/MemeTicker";
import { apiFetch } from "@/lib/api";

export default function Home() {
  const { connected, playAsGuest, guestError, guestPending } = useWallet();
  const [stats, setStats] = useState({ players: 0, boards: 0 });

  useEffect(() => {
    apiFetch(`${API_URL}/health`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) setStats({ players: data.players, boards: data.boards });
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col gap-0 overflow-hidden">
      {/* Hero */}
      <div className="flex flex-col items-center gap-8 py-16 text-center">
        <div className="text-center">
          <div className="text-xs uppercase tracking-[0.3em] text-gray-500 mb-4">Web3 Dice Game on Radix</div>
          <h1 className="text-5xl sm:text-7xl md:text-8xl font-black tracking-tight mb-4">
            <span className="neon-glow">ROLLS</span>{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-cyan-400 to-green-400">GRID</span>
          </h1>
          <p className="text-base sm:text-lg text-gray-400 max-w-lg mx-auto leading-relaxed">
            Roll the dice. Complete the grid. Earn ROLLS and collect legendary NFTs.
          </p>
        </div>

        {/* CTA */}
        <div className="flex flex-col items-center gap-3">
          {connected ? (
            <Link
              href="/play"
              className="px-10 py-4 rounded-xl font-bold text-lg bg-gradient-to-r from-green-600 to-cyan-600 hover:from-green-500 hover:to-cyan-500 text-white shadow-lg shadow-green-500/20 transition-all hover:scale-105"
            >
              Start Playing
            </Link>
          ) : (
            <div className="flex flex-col items-center gap-3">
              {/* Guest ids are issued by the server now, so this is a round-trip:
                  navigate only once we actually hold one, otherwise /play would
                  land on the connect screen with no explanation. */}
              <Link
                href="/play"
                onClick={async (e) => {
                  e.preventDefault();
                  if (await playAsGuest()) window.location.href = "/play";
                }}
                aria-disabled={guestPending}
                className="px-10 py-4 rounded-xl font-bold text-lg bg-gradient-to-r from-green-600 to-cyan-600 hover:from-green-500 hover:to-cyan-500 text-white shadow-lg shadow-green-500/20 transition-all hover:scale-105 aria-disabled:opacity-60 aria-disabled:pointer-events-none"
              >
                {guestPending ? "Starting…" : "Play Free Now"}
              </Link>
              {guestError && (
                <p className="max-w-sm text-center text-xs text-amber-400">{guestError}</p>
              )}
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <span>or</span>
                <ConnectButton className="!px-4 !py-2 !text-sm" />
              </div>
            </div>
          )}
          <Link href="/how-to-play" className="text-xs text-gray-500 hover:text-gray-300 transition-colors underline">
            How does it work?
          </Link>
        </div>

        {/* Live stats */}
        <div className="grid grid-cols-3 gap-8 text-center">
          <Stat value={stats.players} label="Players" color="text-green-400" />
          <Stat value={stats.boards} label="Grids Done" color="text-cyan-400" />
          {/* Earnable NFTs, not catalog size — 10 of the 23 listed are not
              implemented yet. See OBTAINABLE_NFT_COUNT in lib/constants.ts. */}
          <Stat value={OBTAINABLE_NFT_COUNT} label="NFTs" color="text-purple-400" />
        </div>
      </div>

      {/* Meme ticker */}
      <MemeTicker />

      {/* Features */}
      <div className="py-12">
        <div className="max-w-4xl mx-auto grid grid-cols-1 sm:grid-cols-3 gap-6">
          <FeatureCard
            emoji="🎲"
            title="Roll & Win"
            description={`Roll the dice, complete the 8x8 grid. ${CELL_TYPE_COUNT} cell types with unique rewards — every roll gives XP.`}
            color="from-green-500/10 to-green-500/5"
            border="border-green-500/20"
          />
          <FeatureCard
            emoji="💎"
            title="Combos & Jackpots"
            description="Complete rows, columns, diagonals for combo multipliers up to 10x. Chase the BLACKOUT for +500 points!"
            color="from-yellow-500/10 to-yellow-500/5"
            border="border-yellow-500/20"
          />
          <FeatureCard
            emoji="🏆"
            title="Level Up & Collect"
            description={`10 levels from Normie to Meme Lord. ${OBTAINABLE_NFT_COUNT} earnable NFTs across 6 rarities. Daily streaks with escalating rewards.`}
            color="from-purple-500/10 to-purple-500/5"
            border="border-purple-500/20"
          />
        </div>
      </div>

      {/* How it works - compact */}
      <div className="pb-12">
        <div className="max-w-2xl mx-auto neon-border rounded-xl p-6 bg-[var(--bg-card)]">
          <h2 className="text-xl font-bold mb-4 text-center">How It Works</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-gray-300">
            <Step num={1} text="Connect your Radix wallet" />
            <Step num={2} text={`Get ${FREE_STARTING_ROLLS} free ROLLS to try it`} />
            <Step num={3} text={`Start a board (${BOARD_COST_LABEL})`} />
            <Step num={4} text="Roll dice to hit cells (1 ROLLS)" />
            <Step num={5} text="Complete lines for combos" />
            <Step num={6} text="Level up + unlock NFTs" />
          </div>
          <div className="text-center mt-4">
            <Link href="/how-to-play" className="text-xs text-green-400 hover:text-green-300 transition-colors">
              Full rules and strategy guide &rarr;
            </Link>
          </div>
        </div>
      </div>

      {/* Power-ups preview */}
      <div className="pb-12">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-lg font-bold mb-4 text-gray-300">5 Power-Ups to Master</h2>
          <div className="flex justify-center gap-4 flex-wrap">
            {[
              { emoji: "💣", name: "Row Bomb", desc: "Clear a row" },
              { emoji: "🔄", name: "Re-Roll", desc: "Free hit" },
              { emoji: "🔀", name: "Swap", desc: "Remove rug" },
              { emoji: "🧲", name: "Magnet", desc: "Target best" },
              { emoji: "🔍", name: "X-Ray", desc: "See all" },
            ].map((pu) => (
              <div key={pu.name} className="bg-[var(--bg-card)] rounded-lg border border-gray-700/30 px-4 py-3 text-center">
                <div className="text-2xl mb-1">{pu.emoji}</div>
                <div className="text-xs font-bold">{pu.name}</div>
                <div className="text-[10px] text-gray-500">{pu.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Daily challenge CTA */}
      <div className="pb-12">
        <div className="max-w-2xl mx-auto bg-gradient-to-r from-purple-500/10 to-cyan-500/10 border border-purple-500/20 rounded-xl p-6 text-center">
          <div className="text-3xl mb-2">📅</div>
          <h2 className="text-lg font-bold mb-1">Daily Challenge</h2>
          <p className="text-sm text-gray-400 mb-3">A new challenge every day. Chase your best score.</p>
          <Link
            href="/daily"
            className="inline-block px-6 py-2 rounded-lg font-bold text-sm bg-purple-600/20 text-purple-300 border border-purple-500/30 hover:bg-purple-600/30 transition-colors"
          >
            See Today&apos;s Grid
          </Link>
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div>
      <div className={`text-3xl sm:text-4xl font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function FeatureCard({ emoji, title, description, color, border }: {
  emoji: string; title: string; description: string; color: string; border: string;
}) {
  return (
    <div className={`bg-gradient-to-br ${color} rounded-xl border ${border} p-6 text-center hover:scale-[1.02] transition-transform`}>
      <div className="text-4xl mb-3">{emoji}</div>
      <h3 className="font-bold text-lg mb-2">{title}</h3>
      <p className="text-sm text-gray-400 leading-relaxed">{description}</p>
    </div>
  );
}

function Step({ num, text }: { num: number; text: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-7 h-7 rounded-full bg-green-600/20 text-green-400 text-xs font-bold flex items-center justify-center shrink-0">
        {num}
      </span>
      <span>{text}</span>
    </div>
  );
}
