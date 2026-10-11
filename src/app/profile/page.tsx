"use client";
import { useEffect, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import ConnectButton from "@/components/ConnectButton";
import { useGame } from "@/hooks/useGame";
import { API_URL } from "@/lib/constants";
import { truncateAddress, formatMeme } from "@/lib/utils";
import LevelProgress from "@/components/LevelProgress";
import { apiFetch } from "@/lib/api";

interface Achievement {
  achievement_key: string;
  achievement_name: string;
  xp_awarded: number;
  nft_key: string | null;
  created_at: number;
}

interface BoardHistory {
  id: number;
  score: number;
  rolls_used: number;
  cells_completed: number;
  status: string;
  created_at: number;
}

export default function ProfilePage() {
  const { account, connected } = useWallet();
  const { player } = useGame();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [history, setHistory] = useState<BoardHistory[]>([]);

  useEffect(() => {
    if (!account) return;
    apiFetch(`${API_URL}/achievements/${account}`)
      .then((r) => r.json())
      .then((data) => data.ok && setAchievements(data.achievements))
      .catch(() => {});
    apiFetch(`${API_URL}/game/${account}/history?limit=10`)
      .then((r) => r.json())
      .then((data) => data.ok && setHistory(data.history))
      .catch(() => {});
  }, [account]);

  if (!connected || !player) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-20">
        <h1 className="text-3xl font-bold neon-glow">Profile</h1>
        <p className="text-gray-400">Connect your wallet to view your profile</p>
        <ConnectButton />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-6">
      <h1 className="text-2xl font-bold neon-glow">Profile</h1>

      {/* Player identity */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 p-4 flex items-center gap-4">
        <div className="text-4xl">{player.level_emoji}</div>
        <div className="flex-1">
          <div className="font-bold text-lg">{player.level_name}</div>
          <div className="text-sm text-gray-500">{truncateAddress(player.radix_address, 12)}</div>
        </div>
        <div className="text-right">
          <div className="text-sm text-gray-500">Level</div>
          <div className="text-2xl font-bold text-green-400">{player.level}</div>
        </div>
      </div>

      {/* Level progress */}
      <LevelProgress player={player} />

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="ROLLS Balance" value={formatMeme(player.meme_balance)} color="text-yellow-400" />
        <StatCard label="ROLLS Received" value={formatMeme(player.total_meme_deposited)} color="text-green-400" />
        <StatCard label="Total Spent" value={formatMeme(player.total_meme_spent)} color="text-red-400" />
        <StatCard label="XP" value={player.xp.toLocaleString()} color="text-cyan-400" />
        <StatCard label="Grids Completed" value={player.total_boards.toString()} color="text-purple-400" />
        <StatCard label="Total Rolls" value={player.total_rolls.toLocaleString()} color="text-blue-400" />
        <StatCard label="Best Score" value={player.best_score.toString()} color="text-yellow-400" />
        <StatCard label="Level" value={`${player.level} / 10`} color="text-green-400" />
      </div>

      {/* Achievements */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 p-4">
        <h2 className="text-lg font-bold mb-3">Achievements</h2>
        {achievements.length === 0 ? (
          <p className="text-sm text-gray-500">No achievements yet. Start playing to unlock them!</p>
        ) : (
          <div className="space-y-2">
            {achievements.map((a) => (
              <div key={a.achievement_key} className="flex items-center justify-between py-2 border-b border-gray-800/50 last:border-0">
                <div>
                  <span className="font-medium text-sm">{a.achievement_name}</span>
                  {a.nft_key && <span className="text-xs text-purple-400 ml-2">+ NFT</span>}
                </div>
                <span className="text-xs text-cyan-400">+{a.xp_awarded} XP</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Board History */}
      {history.length > 0 && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 p-4">
          <h2 className="text-lg font-bold mb-3">Recent Boards</h2>
          <div className="space-y-2">
            {history.map((b) => (
              <div key={b.id} className="flex items-center justify-between py-2 border-b border-gray-800/50 last:border-0">
                <div className="flex items-center gap-3">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                    b.status === "completed" ? "bg-green-600/20 text-green-400" :
                    b.status === "abandoned" ? "bg-red-600/20 text-red-400" :
                    "bg-yellow-600/20 text-yellow-400"
                  }`}>
                    {b.status}
                  </span>
                  <span className="text-sm">
                    {b.cells_completed}/64 cells | {b.rolls_used} rolls
                  </span>
                </div>
                <span className="text-sm font-bold text-green-400">{b.score} pts</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="grid grid-cols-3 gap-3">
        <QuickLink href="/play" label="Play" emoji="🎲" />
        <QuickLink href="/shop" label="Get ROLLS" emoji="💰" />
        <QuickLink href="/gallery" label="NFTs" emoji="🖼️" />
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-gray-900/50 rounded-lg border border-gray-800/50 p-3 text-center">
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function QuickLink({ href, label, emoji }: { href: string; label: string; emoji: string }) {
  return (
    <a
      href={href}
      className="bg-[var(--bg-card)] rounded-lg border border-gray-700/40 p-3 text-center hover:border-green-500/30 transition-colors"
    >
      <div className="text-2xl mb-1">{emoji}</div>
      <div className="text-xs font-medium">{label}</div>
    </a>
  );
}
