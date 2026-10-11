"use client";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { API_URL } from "@/lib/constants";
import { useWallet } from "./useWallet";
import type { Player, Board, RollOutcome } from "@/lib/types";
import { apiFetch } from "@/lib/api";

interface GameState {
  player: Player | null;
  board: Board | null;
  loading: boolean;
  rolling: boolean;
  lastOutcome: RollOutcome | null;
  achievements: any[];
  error: string | null;
  toast: string | null;
  refresh: () => Promise<void>;
  clearError: () => void;
  clearAchievements: () => void;
  newBoard: (opts?: { daily?: boolean }) => Promise<void>;
  roll: () => Promise<void>;
  useWild: (row: number, col: number) => Promise<void>;
  abandonBoard: () => Promise<void>;
  clearToast: () => void;
}

const GameContext = createContext<GameState>({
  player: null,
  board: null,
  loading: false,
  rolling: false,
  lastOutcome: null,
  achievements: [],
  error: null,
  toast: null,
  refresh: async () => {},
  newBoard: async () => {},
  roll: async () => {},
  useWild: async (_row: number, _col: number) => {},
  abandonBoard: async () => {},
  clearToast: () => {},
  clearError: () => {},
  clearAchievements: () => {},
});

export function useGame() {
  return useContext(GameContext);
}

export function GameProvider({ children }: { children: ReactNode }) {
  const { account, disconnectGuest } = useWallet();
  const [player, setPlayer] = useState<Player | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [loading, setLoading] = useState(false);
  const [rolling, setRolling] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<RollOutcome | null>(null);
  const [achievements, setAchievements] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const clearToast = useCallback(() => setToast(null), []);
  const clearError = useCallback(() => setError(null), []);
  const clearAchievements = useCallback(() => setAchievements([]), []);

  const refresh = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/game/${account}`);
      const data = await res.json();
      if (data.ok) {
        setPlayer(data.player);
        setBoard(data.board);
        setError(null);
      } else if (data.code === "guest_id_invalid") {
        // The stored guest id is not one this server issued — a self-minted
        // leftover, or one signed under a rotated key. Drop it so the UI falls
        // back to the "Play Free (Guest)" screen and a fresh id can be issued;
        // keeping it would loop this error on every refresh with no way out.
        setError(null);
        disconnectGuest();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError("Failed to connect to game server");
    }
    setLoading(false);
  }, [account, disconnectGuest]);

  const newBoard = useCallback(async (opts?: { daily?: boolean }) => {
    if (!account) return;
    setLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/game/${account}/board/new`, {
        method: "POST",
        ...(opts?.daily
          ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ daily: true }) }
          : {}),
      });
      const data = await res.json();
      if (data.ok) {
        setBoard(data.board);
        setPlayer(data.player);
        setLastOutcome(null);
        setToast(data.message);
        setError(null);
      } else {
        setError(data.error ?? "Couldn't start a board.");
      }
    } catch {
      setError("Failed to create board");
    }
    setLoading(false);
  }, [account]);

  const roll = useCallback(async () => {
    if (!account || rolling) return;
    setRolling(true);
    try {
      const res = await apiFetch(`${API_URL}/game/${account}/board/roll`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setLastOutcome(data.outcome);
        setBoard(data.board);
        setPlayer(data.player);
        // Build toast with reward drops
        let msg = data.outcome.message;
        if (data.reward_drops?.length) {
          const dropTexts = data.reward_drops.map((d: any) => `+${d.amount} ${d.token_name}`);
          msg += ` | ${dropTexts.join(", ")}`;
        }
        setToast(msg);
        setError(null);
        if (data.achievements?.length) {
          setAchievements(data.achievements);
        }
      } else {
        setError(data.error ?? "Roll failed.");
      }
    } catch {
      setError("Roll failed");
    }
    setRolling(false);
  }, [account, rolling]);

  const useWild = useCallback(async (row: number, col: number) => {
    if (!account) return;
    setRolling(true);
    try {
      const res = await apiFetch(`${API_URL}/game/${account}/board/wild`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ row, col }),
      });
      const data = await res.json();
      if (data.ok) {
        setLastOutcome(data.outcome);
        setBoard(data.board);
        setPlayer(data.player);
        setToast(data.outcome.message);
        setError(null);
      } else {
        setError(data.error ?? "Wild card failed.");
      }
    } catch {
      setError("Wild card failed");
    }
    setRolling(false);
  }, [account]);

  const abandonBoard = useCallback(async () => {
    if (!account) return;
    setLoading(true);
    try {
      const res = await apiFetch(`${API_URL}/game/${account}/board/abandon`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setBoard(null);
        setPlayer(data.player);
        setLastOutcome(null);
        setToast("Board abandoned.");
        setError(null);
      } else {
        // There was no `else` here. A refused abandon — the one exit a stuck
        // player has — returned 400 and rendered as nothing happening at all.
        setError(data.error ?? "Couldn't abandon the board.");
      }
    } catch {
      setError("Failed to abandon");
    }
    setLoading(false);
  }, [account]);

  useEffect(() => {
    if (account) refresh();
    else {
      setPlayer(null);
      setBoard(null);
    }
  }, [account, refresh]);

  return (
    <GameContext.Provider value={{
      player, board, loading, rolling, lastOutcome, achievements,
      error, toast, refresh, newBoard, roll, useWild, abandonBoard, clearToast,
      clearError, clearAchievements,
    }}>
      {children}
    </GameContext.Provider>
  );
}
