"use client";
import { useCallback, useEffect, useState } from "react";
import { API_URL } from "@/lib/constants";
import { apiFetch } from "@/lib/api";

interface DailyChallenge {
  date: string;
  grid_size: number;
  description: string;
}

export default function DailyPage() {
  const [challenge, setChallenge] = useState<DailyChallenge | null>(null);
  // `challenge === null` meant three different things — still loading, the
  // request failed, and there is no challenge — and the whole "Play Today's
  // Grid" block was hidden for all three. A dead server rendered as a page with
  // nothing on it but "Coming Soon". Track the states separately.
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  const load = useCallback(() => {
    setStatus("loading");
    apiFetch(`${API_URL}/daily/challenge/today`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok) { setChallenge(data); setStatus("ready"); }
        else { setStatus("failed"); }
      })
      .catch(() => setStatus("failed"));
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-2xl font-bold neon-glow">Daily Challenge</h1>

      {status === "loading" && (
        <div className="rounded-xl border border-gray-700/40 bg-[var(--bg-card)] p-6 text-center text-sm text-gray-400">
          <span className="animate-pulse">Loading today&apos;s grid…</span>
        </div>
      )}

      {status === "failed" && (
        <div role="alert" className="rounded-xl border border-amber-600/40 bg-amber-950/30 p-6 text-center">
          <p className="text-sm text-amber-300">Couldn&apos;t load today&apos;s challenge.</p>
          <button
            onClick={load}
            className="mt-3 rounded-lg border border-amber-600/40 bg-amber-900/30 px-5 py-2 text-sm font-bold text-amber-200 transition-colors hover:bg-amber-900/50"
          >
            Try again
          </button>
        </div>
      )}

      {/* Today's challenge */}
      {status === "ready" && challenge && (
        <div className="neon-border rounded-xl p-6 bg-[var(--bg-card)] text-center">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Today&apos;s Grid</div>
          <div className="text-4xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-green-400 to-cyan-400 mb-2">
            {challenge.date}
          </div>
          <p className="text-sm text-gray-400 mb-4">{challenge.description}</p>
          <div className="flex justify-center gap-6 text-xs text-gray-500">
            <div>
              <span className="text-lg text-purple-400 font-bold">{challenge.grid_size}x{challenge.grid_size}</span>
              <div>Grid</div>
            </div>
          </div>
          <div className="mt-4">
            <a
              href="/play?daily=1"
              className="inline-block px-6 py-2 rounded-lg font-bold text-sm bg-gradient-to-r from-green-600 to-cyan-600 hover:from-green-500 hover:to-cyan-500 text-white shadow-lg shadow-green-500/20 transition-all"
            >
              Play Today&apos;s Grid
            </a>
          </div>
        </div>
      )}

      {/* Coming soon */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 p-6 text-center">
        <div className="text-3xl mb-3">&#x1F3C6;</div>
        <h2 className="text-lg font-bold mb-2">Daily Leaderboard</h2>
        <p className="text-sm text-gray-500 mb-4">
          Ranked daily scores and prizes are not live yet.
        </p>
        <div className="inline-block px-4 py-2 rounded-full text-xs font-bold bg-yellow-500/10 text-yellow-400 border border-yellow-500/20">
          Coming Soon
        </div>
      </div>

      {/* How daily works */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 p-5">
        <h3 className="text-sm font-bold mb-3">How Daily Challenge Works</h3>
        <div className="space-y-2 text-xs text-gray-400">
          <div className="flex gap-2">
            <span className="text-green-400 shrink-0">1.</span>
            <span>Starting from &quot;Play Today&apos;s Grid&quot; gives everyone the same board layout today</span>
          </div>
          <div className="flex gap-2">
            <span className="text-green-400 shrink-0">2.</span>
            <span>Dice rolls are random — strategy matters in power-up usage</span>
          </div>
          <div className="flex gap-2">
            <span className="text-green-400 shrink-0">3.</span>
            <span>Complete the grid for the highest score you can</span>
          </div>
          <div className="flex gap-2">
            <span className="text-green-400 shrink-0">4.</span>
            <span>The challenge date rolls over every day at midnight UTC</span>
          </div>
        </div>
      </div>
    </div>
  );
}
