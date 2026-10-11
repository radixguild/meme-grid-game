"use client";
import { useCallback, useEffect, useState } from "react";
import { API_URL } from "@/lib/constants";
import { truncateAddress } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

// The admin token is a SECRET and must never be baked into the client bundle —
// no NEXT_PUBLIC_* default, no hardcoded fallback. The operator pastes it into
// the form below and it is held in sessionStorage, which is per-tab and dies
// with the tab, so a shared browser does not leak it into localStorage.
const TOKEN_STORAGE_KEY = "meme-grid-admin-token";

interface AdminStats {
  system: {
    version: string;
    uptime: number;
    network: string;
    vault_component: string | null;
    meme_resource: string | null;
    // Not currently returned by GET /api/admin/stats — optional so the page
    // renders a placeholder instead of the string "undefined".
    db_path?: string;
    node_version?: string;
  };
  stats: {
    players: number;
    boards_completed: number;
    boards_active: number;
    boards_abandoned: number;
    total_rolls: number;
    total_meme_deposited: number;
    total_meme_spent: number;
    total_achievements: number;
    total_nfts: number;
    total_deposits: number;
    total_powerups: number;
    highest_score: number;
    avg_score: number;
  };
  recent_players: any[];
  recent_boards: any[];
}

export default function AdminPage() {
  const [data, setData] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [tokenInput, setTokenInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (token: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch(`${API_URL}/admin/stats`, {
        headers: { "x-admin-token": token },
      });
      if (res.status === 401) {
        sessionStorage.removeItem(TOKEN_STORAGE_KEY);
        setData(null);
        setError("Invalid or expired admin token.");
        return;
      }
      if (res.status === 429) {
        setError("Admin rate limit exceeded (20/min). Wait a minute and retry.");
        return;
      }
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body?.error ?? `Request failed (${res.status}).`);
        return;
      }
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
      setData(body);
    } catch {
      setError("Could not reach the admin API.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const saved = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    if (saved) void load(saved);
    else setLoading(false);
  }, [load]);

  function signOut() {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    setData(null);
    setTokenInput("");
    setError(null);
  }

  if (loading) return <div className="text-center py-20 text-gray-400">Loading admin data...</div>;

  if (!data) {
    return (
      <div className="max-w-sm mx-auto py-20">
        <h1 className="text-2xl font-bold neon-glow mb-2">Admin Dashboard</h1>
        <p className="text-xs text-gray-500 mb-4">
          Paste the admin token to continue. It is kept in this tab only and is never
          stored in the site bundle.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (tokenInput.trim()) void load(tokenInput.trim());
          }}
          className="flex flex-col gap-3"
        >
          {/* Placeholder-as-label: WCAG 1.3.1/3.3.2 does not accept it, and it
              disappears the moment anything is typed. */}
          <label htmlFor="admin-token" className="text-xs uppercase tracking-wider text-gray-400">
            Admin token
          </label>
          <input
            id="admin-token"
            type="password"
            autoComplete="off"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="Admin token"
            className="rounded-lg bg-gray-900/60 border border-gray-700/50 px-3 py-2 text-sm font-mono text-gray-200 focus:border-green-500/50 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!tokenInput.trim()}
            className="rounded-lg px-4 py-2 text-sm font-bold bg-gradient-to-r from-green-600 to-cyan-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Unlock
          </button>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </form>
      </div>
    );
  }

  const { system, stats, recent_players, recent_boards } = data;

  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold neon-glow">Admin Dashboard</h1>
        <button
          onClick={signOut}
          className="px-3 py-1 rounded text-xs font-medium bg-gray-800/50 text-gray-400 border border-gray-700/30 hover:text-white hover:border-gray-600 transition-colors"
        >
          Lock
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}

      {/* System Info */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 p-4">
        <h2 className="text-sm font-bold text-gray-400 mb-3">System</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <Info label="Version" value={system.version} />
          <Info label="Uptime" value={`${Math.floor(system.uptime / 60)}m`} />
          <Info label="Network" value={system.network} color="text-green-400" />
          <Info label="Node" value={system.node_version ?? "—"} />
        </div>
      </div>

      {/* On-Chain Addresses */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 p-4">
        <h2 className="text-sm font-bold text-gray-400 mb-3">On-Chain (Scrypto)</h2>
        <div className="space-y-2 text-xs">
          <div className="flex justify-between">
            <span className="text-gray-500">Vault Component</span>
            <span className={system.vault_component ? "text-green-400 font-mono" : "text-yellow-400"}>
              {system.vault_component ? truncateAddress(system.vault_component, 16) : "Not deployed"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">ROLLS Resource</span>
            <span className={system.meme_resource ? "text-green-400 font-mono" : "text-yellow-400"}>
              {system.meme_resource ? truncateAddress(system.meme_resource, 16) : "Not deployed"}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-500">Token Mode</span>
            <span className={system.vault_component ? "text-green-400" : "text-yellow-400"}>
              {system.vault_component ? "On-chain (real ROLLS)" : "Test mode (free credits)"}
            </span>
          </div>
        </div>
      </div>

      {/* Game Stats */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 p-4">
        <h2 className="text-sm font-bold text-gray-400 mb-3">Game Stats</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Players" value={stats.players} color="text-green-400" />
          <StatCard label="Boards Done" value={stats.boards_completed} color="text-cyan-400" />
          <StatCard label="Active Boards" value={stats.boards_active} color="text-yellow-400" />
          <StatCard label="Abandoned" value={stats.boards_abandoned} color="text-red-400" />
          <StatCard label="Total Rolls" value={stats.total_rolls} color="text-purple-400" />
          <StatCard label="ROLLS Deposited" value={stats.total_meme_deposited} color="text-green-400" />
          <StatCard label="ROLLS Spent" value={stats.total_meme_spent} color="text-red-400" />
          <StatCard label="Deposits" value={stats.total_deposits} color="text-blue-400" />
          <StatCard label="Achievements" value={stats.total_achievements} color="text-yellow-400" />
          <StatCard label="NFTs Earned" value={stats.total_nfts} color="text-purple-400" />
          <StatCard label="Power-Ups Held" value={stats.total_powerups} color="text-orange-400" />
          <StatCard label="Highest Score" value={stats.highest_score} color="text-green-400" />
        </div>
      </div>

      {/* Recent Players */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 p-4">
        <h2 className="text-sm font-bold text-gray-400 mb-3">Recent Players</h2>
        {recent_players.length === 0 ? (
          <div className="text-xs text-gray-500">No players yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left py-2 pr-4">Address</th>
                  <th className="text-right py-2 px-2">Level</th>
                  <th className="text-right py-2 px-2">XP</th>
                  <th className="text-right py-2 px-2">ROLLS</th>
                  <th className="text-right py-2 px-2">Rolls</th>
                  <th className="text-right py-2 pl-2">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {recent_players.map((p: any) => (
                  <tr key={p.radix_address} className="border-b border-gray-800/30">
                    <td className="py-2 pr-4 font-mono text-gray-300">{truncateAddress(p.radix_address, 10)}</td>
                    <td className="py-2 px-2 text-right text-cyan-400">{p.level}</td>
                    <td className="py-2 px-2 text-right">{p.xp}</td>
                    <td className="py-2 px-2 text-right text-yellow-400">{p.meme_balance}</td>
                    <td className="py-2 px-2 text-right">{p.total_rolls}</td>
                    <td className="py-2 pl-2 text-right text-gray-500">{new Date(p.last_active * 1000).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Boards */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 p-4">
        <h2 className="text-sm font-bold text-gray-400 mb-3">Recent Boards</h2>
        {recent_boards.length === 0 ? (
          <div className="text-xs text-gray-500">No boards yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left py-2 pr-2">ID</th>
                  <th className="text-left py-2 px-2">Player</th>
                  <th className="text-right py-2 px-2">Score</th>
                  <th className="text-right py-2 px-2">Rolls</th>
                  <th className="text-right py-2 px-2">Cells</th>
                  <th className="text-right py-2 pl-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {recent_boards.map((b: any) => (
                  <tr key={b.id} className="border-b border-gray-800/30">
                    <td className="py-2 pr-2 text-gray-400">#{b.id}</td>
                    <td className="py-2 px-2 font-mono text-gray-300">{truncateAddress(b.radix_address, 8)}</td>
                    <td className="py-2 px-2 text-right text-green-400">{b.score}</td>
                    <td className="py-2 px-2 text-right">{b.rolls_used}</td>
                    <td className="py-2 px-2 text-right">{b.cells_completed}/64</td>
                    <td className="py-2 pl-2 text-right">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        b.status === "completed" ? "bg-green-600/20 text-green-400" :
                        b.status === "active" ? "bg-yellow-600/20 text-yellow-400" :
                        "bg-red-600/20 text-red-400"
                      }`}>{b.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Services */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 p-4">
        <h2 className="text-sm font-bold text-gray-400 mb-3">Services</h2>
        <div className="space-y-2 text-xs">
          <ServiceRow name="meme-grid-server" port={3004} desc="Express API + SQLite" status="online" />
          <ServiceRow name="meme-grid-app" port={3005} desc="Next.js frontend" status="online" />
          <ServiceRow name="Scrypto MemeGameVault" port={0} desc="On-chain token contract" status={system.vault_component ? "deployed" : "pending"} />
          <ServiceRow name="Caddy" port={443} desc="Reverse proxy + SSL" status="online" />
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 p-4">
        <h2 className="text-sm font-bold text-gray-400 mb-3">Quick Links</h2>
        <div className="flex flex-wrap gap-2">
          <QuickLink href="/api/health" label="API Health" />
          <QuickLink href="/api/leaderboard" label="Leaderboard API" />
          <QuickLink href="/api/nfts/catalog" label="NFT Catalog" />
          <QuickLink href="/api/token/info" label="Token Info" />
          <QuickLink href="/api/daily/challenge/today" label="Daily Challenge" />
          <QuickLink href="https://github.com/radixguild/meme-grid-game" label="GitHub" external />
        </div>
      </div>
    </div>
  );
}

function Info({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-gray-500">{label}</div>
      <div className={`font-medium ${color || "text-gray-300"}`}>{value}</div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-gray-900/50 rounded-lg border border-gray-800/50 p-2 text-center">
      <div className={`text-lg font-bold ${color}`}>{value.toLocaleString()}</div>
      <div className="text-[9px] text-gray-500 uppercase tracking-wider">{label}</div>
    </div>
  );
}

function ServiceRow({ name, port, desc, status }: { name: string; port: number; desc: string; status: string }) {
  const statusColor = status === "online" || status === "deployed" ? "text-green-400" : "text-yellow-400";
  return (
    <div className="flex items-center justify-between py-1 border-b border-gray-800/30 last:border-0">
      <div>
        <span className="font-medium text-gray-300">{name}</span>
        {port > 0 && <span className="text-gray-400 ml-2">:{port}</span>}
        <span className="text-gray-400 ml-2">— {desc}</span>
      </div>
      <span className={`text-[10px] font-bold uppercase ${statusColor}`}>{status}</span>
    </div>
  );
}

function QuickLink({ href, label, external }: { href: string; label: string; external?: boolean }) {
  const fullHref = external ? href : `${typeof window !== "undefined" ? window.location.origin : ""}${href}`;
  return (
    <a
      href={fullHref}
      target="_blank"
      rel="noopener noreferrer"
      className="px-3 py-1 rounded text-xs font-medium bg-gray-800/50 text-gray-400 border border-gray-700/30 hover:text-white hover:border-gray-600 transition-colors"
    >
      {label}
    </a>
  );
}
