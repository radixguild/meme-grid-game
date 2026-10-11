"use client";
import { useEffect, useState, useCallback } from "react";
import { API_URL } from "@/lib/constants";
import { useWallet } from "@/hooks/useWallet";
import { POWER_UPS } from "@/lib/game-config";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/api";

interface PowerUpInventory {
  powerup_type: string;
  quantity: number;
}

interface PowerUpBarProps {
  onUse: (type: string, row?: number, col?: number) => void;
  boardActive: boolean;
  onRefresh?: () => void;
}

export default function PowerUpBar({ onUse, boardActive, onRefresh }: PowerUpBarProps) {
  const { account } = useWallet();
  const [inventory, setInventory] = useState<PowerUpInventory[]>([]);
  const [buying, setBuying] = useState<string | null>(null);
  const [using, setUsing] = useState<string | null>(null);
  // Both handlers used to branch only on `data.ok`, with a bare `catch {}` and no
  // else — so the server's own actionable message ("Not enough ROLLS. Need 30,
  // have 4.", "No Row Bomb available") was read off the wire and dropped on the
  // floor. Clicking Buy with an empty balance flashed "..." and changed nothing.
  const [failure, setFailure] = useState<string | null>(null);

  const refreshInventory = useCallback(() => {
    if (!account) return;
    apiFetch(`${API_URL}/powerups/${account}`)
      .then((r) => r.json())
      .then((data) => data.ok && setInventory(data.inventory))
      .catch(() => {});
  }, [account]);

  useEffect(() => { refreshInventory(); }, [refreshInventory]);

  const handleBuy = async (type: string) => {
    if (!account || buying) return;
    setBuying(type);
    setFailure(null);
    try {
      const res = await apiFetch(`${API_URL}/powerups/${account}/buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (data.ok) {
        setInventory(data.inventory);
        onRefresh?.();
      } else {
        setFailure(data.error ?? "Couldn't buy that power-up.");
      }
    } catch {
      setFailure("Couldn't reach the game server.");
    }
    setBuying(null);
  };

  const handleUse = async (type: string) => {
    if (!account || !boardActive || using) return;

    setUsing(type);
    setFailure(null);
    try {
      const res = await apiFetch(`${API_URL}/powerups/${account}/use`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type }),
      });
      const data = await res.json();
      if (data.ok) {
        setInventory(data.inventory);
        onUse(type);
        onRefresh?.();
      } else {
        setFailure(data.error ?? "Couldn't use that power-up.");
      }
    } catch {
      setFailure("Couldn't reach the game server.");
    }
    setUsing(null);
  };

  const getCount = (type: string) => inventory.find((i) => i.powerup_type === type)?.quantity ?? 0;

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 p-3">
      <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-2">Power-Ups</h3>
      <div className="flex flex-col gap-1.5">
        {POWER_UPS.map((pu) => {
          const count = getCount(pu.type);
          const hasItem = count > 0;
          const isBuying = buying === pu.type;
          const isUsing = using === pu.type;

          return (
            <div key={pu.type} className="flex items-center gap-2">
              {/* Icon + name */}
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="text-base shrink-0">{pu.emoji}</span>
                <span className="text-xs text-gray-300 truncate">{pu.name}</span>
                {hasItem && (
                  <span className="shrink-0 w-4 h-4 bg-purple-500 rounded-full text-[10px] font-bold flex items-center justify-center text-white">
                    {count}
                  </span>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-1.5 shrink-0">
                {hasItem && boardActive && (
                  <button
                    onClick={() => handleUse(pu.type)}
                    disabled={isUsing}
                    aria-label={`Use ${pu.name} (${count} available)`}
                    className={cn(
                      "px-2.5 py-1 rounded text-[11px] font-medium border transition-all",
                      "bg-purple-600/20 border-purple-500/40 text-purple-300 hover:bg-purple-600/30",
                      isUsing && "opacity-50"
                    )}
                  >
                    {isUsing ? "..." : "Use"}
                  </button>
                )}
                <button
                  onClick={() => handleBuy(pu.type)}
                  disabled={isBuying}
                  aria-label={`Buy ${pu.name} for ${pu.cost} ROLLS — ${pu.description}`}
                  className={cn(
                    "px-2.5 py-1 rounded text-[11px] font-medium border transition-all",
                    "bg-[var(--bg-card)] border-gray-700/40 text-gray-400 hover:border-gray-500 hover:text-gray-300",
                    isBuying && "opacity-50"
                  )}
                >
                  {/* Was `${pu.cost}M` — an "M" for the currency this game stopped
                      using, sitting one row above an inventory count. Every other
                      price on the site (DiceRoller, MobileRollBar, how-to-play,
                      tokenomics) spells ROLLS. */}
                  {isBuying ? "..." : `${pu.cost} ROLLS`}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {failure && (
        <p role="status" className="mt-2 text-[11px] text-amber-400">
          {failure}
        </p>
      )}
    </div>
  );
}
