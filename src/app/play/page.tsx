"use client";
import { useState, useEffect } from "react";
import { useWallet } from "@/hooks/useWallet";
import ConnectButton from "@/components/ConnectButton";
import { useGame } from "@/hooks/useGame";
import { ROLL_COST, BOARD_COST, GRID_SIZE, API_URL, BOARD_COST_LABEL, FREE_STARTING_ROLLS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import GameBoard from "@/components/GameBoard";
import DiceRoller from "@/components/DiceRoller";
import ScoreBar from "@/components/ScoreBar";
import RollResult from "@/components/RollResult";
import LevelProgress from "@/components/LevelProgress";
import NearMissIndicator from "@/components/NearMissIndicator";
import StreakBanner from "@/components/StreakBanner";
import PowerUpBar from "@/components/PowerUpBar";
import Confetti from "@/components/Confetti";
import MobileRollBar from "@/components/MobileRollBar";
import { useSound } from "@/hooks/useSound";
import { apiFetch } from "@/lib/api";

export default function PlayPage() {
  const { account, connected, isGuest, playAsGuest, guestError, guestPending } = useWallet();
  const { player, board, loading, rolling, lastOutcome, error, newBoard, roll, useWild, abandonBoard, toast, clearToast, refresh, clearError, achievements, clearAchievements } = useGame();
  const sound = useSound();
  const [dailyReward, setDailyReward] = useState<string | null>(null);
  const [prevLevel, setPrevLevel] = useState<number | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const [wildMode, setWildMode] = useState(false);
  const [otterFlash, setOtterFlash] = useState(false);
  const [dailyRequested, setDailyRequested] = useState(false);

  // Toasts used to persist until dismissed by hand, so a board start followed by
  // a roll left two full-width bars stacked above the grid, each pushing the board
  // further down the page. They are transient status, not messages to action.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(clearToast, 4000);
    return () => clearTimeout(t);
  }, [toast, clearToast]);

  useEffect(() => {
    if (!dailyReward) return;
    const t = setTimeout(() => setDailyReward(null), 8000);
    return () => clearTimeout(t);
  }, [dailyReward]);

  // Landed here via /daily's "Play Today's Grid" link (?daily=1) — the next
  // board created should be the deterministic Daily Challenge grid rather
  // than a random one. Read from the URL directly (no useSearchParams) so
  // this page doesn't pick up a Suspense-boundary requirement for one param.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("daily") === "1") {
      setDailyRequested(true);
    }
  }, []);

  const startBoard = () => {
    const daily = dailyRequested;
    setDailyRequested(false); // one board per /daily visit, not every board this session
    newBoard(daily ? { daily: true } : undefined);
  };

  // Sound effects on game events
  useEffect(() => {
    if (!lastOutcome) return;
    if (lastOutcome.boardCompleted) {
      sound.playBoardComplete();
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 4000);
    } else if (lastOutcome.lines && lastOutcome.lines.length > 0) {
      sound.playCombo();
    } else if (lastOutcome.cellType === "otter" && lastOutcome.cellCompleted) {
      sound.playCombo();
    } else if (lastOutcome.cellType === "rug_pull" && lastOutcome.cellCompleted) {
      sound.playRugPull();
    } else if (lastOutcome.wildCardEarned) {
      sound.playWildCard();
    } else if (lastOutcome.cellCompleted) {
      sound.playCellComplete();
    } else {
      sound.playCellHit();
    }
  }, [lastOutcome, sound]);

  // Otter drop celebration — the big-drop tile gets a moment
  useEffect(() => {
    if (lastOutcome?.cellType === "otter" && lastOutcome.cellCompleted) {
      setShowConfetti(true);
      setOtterFlash(true);
      const t1 = setTimeout(() => setShowConfetti(false), 2500);
      const t2 = setTimeout(() => setOtterFlash(false), 1800);
      return () => { clearTimeout(t1); clearTimeout(t2); };
    }
  }, [lastOutcome]);

  // Level up sound
  useEffect(() => {
    if (!player) return;
    if (prevLevel !== null && player.level > prevLevel) {
      sound.playLevelUp();
    }
    setPrevLevel(player.level);
  }, [player?.level, prevLevel, sound]);

  // Daily check-in on first load
  useEffect(() => {
    if (!account) return;
    apiFetch(`${API_URL}/daily/${account}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.reward && !data.already_checked_in) {
          const parts = [];
          if (data.reward.freeMeme > 0) parts.push(`+${data.reward.freeMeme} ROLLS`);
          if (data.reward.freeRolls > 0) parts.push(`+${data.reward.freeRolls} free rolls`);
          if (data.reward.powerUp) parts.push(`+1 ${data.reward.powerUp}`);
          setDailyReward(`Day ${data.streak} streak! ${parts.join(", ")}`);
          refresh();
        }
      })
      .catch(() => {});
  }, [account, refresh]);

  if (!connected) {
    return (
      <div className="flex flex-col items-center justify-center gap-6 py-20">
        <h1 className="text-3xl font-bold neon-glow">Ready to Play?</h1>
        <p className="text-gray-400 text-center max-w-md">
          Connect your Radix wallet or play for free as a guest.
          Same game, same fun — guests get {FREE_STARTING_ROLLS} free ROLLS to try it.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => { void playAsGuest(); }}
            disabled={guestPending}
            className="px-8 py-3 rounded-xl font-bold text-lg bg-gradient-to-r from-green-600 to-cyan-600 hover:from-green-500 hover:to-cyan-500 text-white shadow-lg shadow-green-500/20 transition-all hover:scale-105 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            {guestPending ? "Starting…" : "Play Free (Guest)"}
          </button>
          <div className="flex items-center">
            <ConnectButton />
          </div>
        </div>
        {guestError && (
          <p className="max-w-md text-center text-sm text-amber-400">{guestError}</p>
        )}
        {/* The guest id lives in sessionStorage (useWallet.tsx) and connecting a
            wallet swaps `account` outright — the guest's board and balance are
            orphaned, not migrated. That was documented in a code comment as a
            deliberate "nudge to connect" and said nowhere a player could see it. */}
        <p className="max-w-md text-center text-xs text-gray-500">
          Guests can play the full game. Guest progress lives in this browser tab only —
          it is not carried over when you connect a wallet, so connect first if you want
          to keep what you earn.
        </p>
      </div>
    );
  }

  if (loading && !player) {
    return <div className="flex items-center justify-center py-20"><div className="text-gray-400 animate-pulse">Loading game...</div></div>;
  }

  // No player and not loading means the fetch failed. `return null` here used to
  // render a blank page with no way to tell a dead server from a slow one — and
  // the guest-id rejection path (useGame.tsx) now routes through this component,
  // so it needs to actually say something.
  if (!player) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <p className="text-sm text-amber-400">{error ?? "Couldn't load your game."}</p>
        <button
          onClick={() => { void refresh(); }}
          className="px-6 py-2 rounded-lg font-bold text-sm bg-gray-800 border border-gray-700 hover:bg-gray-700 transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  const hasActiveBoard = board && board.status === "active";
  const boardCompleted = board && board.status === "completed";

  // Can this player actually start a board?
  //
  // This was three hardcoded `player.meme_balance < 50` checks, written when
  // BOARD_COST was 50. BOARD_COST is 0 now and the free trial grants 15, so the
  // literal survived into a state where it disabled "New Board" for EVERY new
  // player — under a button whose own label read "New Board (free)", above a
  // "Not enough ROLLS — Buy more" link pointing at a shop that cannot sell
  // anything in phase 1. A brand-new player could not start a game at all.
  //
  // Derived from the constants now, so it follows the price instead of pinning a
  // number the price left behind. A board you cannot roll on is useless, so the
  // bar is the start fee plus one roll.
  const canAffordBoard = !player || player.meme_balance >= BOARD_COST + ROLL_COST;
  const canRoll = hasActiveBoard && (player.meme_balance >= ROLL_COST || board.extra_turns > 0);
  const totalCells = GRID_SIZE * GRID_SIZE;

  // With no board in play, LevelProgress + ScoreBar + StreakBanner ran ~300px
  // ahead of the only button on the page. On a 375px phone that put "New Board"
  // below the fold behind a wall of the player's own zeroes. Once a board exists
  // the stats are live information and belong at the top; until then the CTA does.
  const idle = !hasActiveBoard && !boardCompleted;

  // One always-mounted live region for everything transient. A region has to be
  // in the accessibility tree BEFORE its content changes for the change to be
  // announced — mounting the region and the text together, which is what the
  // conditional toast/result/error banners do, is the case AT most reliably
  // misses. So those stay visual, and this narrates them.
  const announcement = error
    ? error
    : lastOutcome
      ? [
          lastOutcome.message,
          lastOutcome.scoreChange !== 0 ? `${lastOutcome.scoreChange > 0 ? "+" : ""}${lastOutcome.scoreChange} points` : null,
          lastOutcome.xpEarned > 0 ? `+${lastOutcome.xpEarned} XP` : null,
          lastOutcome.comboMultiplier > 1 ? `combo x${lastOutcome.comboMultiplier}` : null,
          lastOutcome.boardCompleted ? "Board complete!" : null,
        ].filter(Boolean).join(", ")
      : toast ?? "";
  const statsBlock = (
    <>
      <LevelProgress player={player} />
      <ScoreBar player={player} board={board} />
      {player.streak_current > 0 && (
        <StreakBanner streak={player.streak_current} longestStreak={player.streak_longest} />
      )}
    </>
  );

  return (
    <div className={cn("flex flex-col gap-4", hasActiveBoard && "pb-24 lg:pb-0")}>
      {/* The only <h1> on this page lived in the `!connected` branch, so during
          actual gameplay — the state that matters — heading navigation found no
          top-level heading at all. Visually hidden: the board is its own title. */}
      <h1 className="sr-only">MEME GRID — play</h1>
      <div className="sr-only" aria-live="polite" aria-atomic="true" role="status">
        {announcement}
      </div>
      {showConfetti && <Confetti />}
      {otterFlash && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center">
          <div className="animate-score-pop rounded-2xl border border-purple-400/50 bg-purple-600/95 px-8 py-5 text-center shadow-2xl shadow-purple-500/40">
            {/* Not a "drop". `rollLuckyDrop` in server/src/game/rewards.ts uses one
                flat `drop_chance` per COMPLETED CELL, settled at board completion,
                with no branch on `cell.type` — an otter has exactly the same odds as
                a blank tile, and today the vault is empty so the odds are zero. What
                the otter really pays is XP: 30 against a normal cell's 10. Say that. */}
            <div className="text-6xl leading-none">🦦</div>
            <div className="mt-2 text-xl font-bold text-white">Purple otter!</div>
            <div className="text-xs text-purple-100">Radix mascot — triple XP</div>
          </div>
        </div>
      )}

      {isGuest && (
        <p className="text-center text-[11px] text-gray-500">
          Playing as a guest — progress is kept in this browser tab only and does not
          transfer to a wallet.{" "}
          <a href="/play" className="underline hover:text-gray-300">Connect a wallet</a> to keep it.
        </p>
      )}

      {/* Top bar: level + score — see `idle` above for why this moves. */}
      {!idle && statsBlock}

      {dailyReward && (
        <div className="animate-slide-up bg-gradient-to-r from-yellow-500/10 to-orange-500/10 border border-yellow-500/30 rounded-lg p-3 text-center text-sm flex items-center justify-between">
          <span className="text-yellow-400">{dailyReward}</span>
          <button onClick={() => setDailyReward(null)} className="text-gray-500 hover:text-white ml-2">x</button>
        </div>
      )}
      {toast && (
        <div role="status" aria-live="polite" className="animate-slide-up bg-[var(--bg-card)] border border-green-500/30 rounded-lg p-3 text-center text-sm flex items-center justify-between">
          <span>{toast}</span>
          <button onClick={clearToast} aria-label="Dismiss message" className="text-gray-500 hover:text-white ml-2">x</button>
        </div>
      )}

      {/* `error` is written by roll(), newBoard(), useWild() and abandonBoard(),
          and until now was read in exactly one place: the `!player` branch above,
          which only renders before a player has ever loaded. So for the whole of
          a real session every failed action — rate limit, stale board, a raced
          balance check — set this string and nothing displayed it. The dice just
          stopped. */}
      {error && (
        <div role="alert" className="animate-slide-up bg-amber-950/40 border border-amber-600/40 rounded-lg p-3 text-sm flex items-center justify-between gap-3">
          <span className="text-amber-300">{error}</span>
          <button onClick={clearError} aria-label="Dismiss error" className="shrink-0 text-amber-500/70 hover:text-amber-200">x</button>
        </div>
      )}

      {/* Achievements were stored in game state and rendered by no component —
          unlocking one (which can also queue an NFT mint) produced no feedback
          at all; you found out later on /profile. */}
      {achievements.length > 0 && (
        <div role="status" aria-live="polite" className="animate-slide-up bg-gradient-to-r from-purple-500/15 to-fuchsia-500/10 border border-purple-500/40 rounded-lg p-3 text-sm flex items-center justify-between gap-3">
          <span className="text-purple-200">
            <span className="font-bold">Achievement unlocked!</span>{" "}
            {achievements.map((a: any) => a?.name ?? a?.key).filter(Boolean).join(", ")}
          </span>
          <button onClick={clearAchievements} aria-label="Dismiss achievement" className="shrink-0 text-purple-400/70 hover:text-purple-200">x</button>
        </div>
      )}

      {/* No board / Board complete states */}
      {idle && (
        <div className="mx-auto max-w-md text-center py-8 sm:py-12">
          <h2 className="text-2xl font-bold mb-2">{dailyRequested ? "Today's Daily Challenge" : "Ready to Play?"}</h2>
          <p className="text-gray-400 mb-6">
            {dailyRequested
              ? `Same grid as every other player today — ${BOARD_COST_LABEL} to start`
              : `Start a new 8x8 grid board — ${BOARD_COST_LABEL}`}
          </p>
          <button onClick={startBoard} disabled={loading || !canAffordBoard}
            className="px-8 py-3 rounded-xl font-bold bg-gradient-to-r from-green-600 to-cyan-600 hover:from-green-500 hover:to-cyan-500 text-white shadow-lg shadow-green-500/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed">
            {loading ? "Creating..." : dailyRequested ? `Start Daily Challenge (${BOARD_COST_LABEL})` : `New Board (${BOARD_COST_LABEL})`}
          </button>
          {!canAffordBoard && <p className="text-xs text-red-400 mt-2">Not enough ROLLS. <a href="/shop" className="underline">Buy more</a></p>}
        </div>
      )}

      {idle && statsBlock}

      {boardCompleted && (
        <div className="flex flex-col gap-4">
          <div className="mx-auto w-full max-w-md text-center py-6 neon-border rounded-xl bg-[var(--bg-card)] p-6">
            <h2 className="text-3xl font-bold neon-glow mb-2">Board Complete!</h2>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div><div className="text-2xl font-bold text-green-400">{board.score}</div><div className="text-[10px] text-gray-500">SCORE</div></div>
              <div><div className="text-2xl font-bold text-cyan-400">{board.rolls_used}</div><div className="text-[10px] text-gray-500">ROLLS</div></div>
              <div><div className="text-2xl font-bold text-purple-400">{board.lines_completed || 0}</div><div className="text-[10px] text-gray-500">LINES</div></div>
            </div>
            <button onClick={() => newBoard()} disabled={loading || !canAffordBoard}
              className="px-8 py-3 rounded-xl font-bold bg-gradient-to-r from-green-600 to-cyan-600 text-white shadow-lg shadow-green-500/20 transition-all disabled:opacity-40">
              New Board ({BOARD_COST_LABEL})
            </button>
          </div>
          <GameBoard grid={board.grid} wildMode={false} />
        </div>
      )}

      {/* Active board — SIDEBAR LAYOUT */}
      {hasActiveBoard && (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,640px)_320px] gap-4 mx-auto w-full max-w-[980px]">
          {/* LEFT: Grid — locked max size */}
          <div className="flex flex-col gap-3 w-full">
            <div className="flex items-center justify-between text-xs text-gray-500">
              {/* Score is deliberately absent: it is the second StatCard directly
                  above this line, and repeating it here just competes with the
                  board for vertical space on a phone. */}
              <span>{board.cells_completed}/{totalCells} cells</span>
              <span>Rolls: {board.rolls_used}</span>
            </div>

            {(board.xray_remaining > 0 || board.magnet_remaining > 0) && (
              <div className="flex gap-2 text-xs">
                {board.xray_remaining > 0 && <span className="px-2 py-1 bg-blue-500/20 border border-blue-500/30 rounded text-blue-300">👁 X-Ray ({board.xray_remaining} rolls)</span>}
                {board.magnet_remaining > 0 && <span className="px-2 py-1 bg-orange-500/20 border border-orange-500/30 rounded text-orange-300">🧲 Magnet ({board.magnet_remaining} rolls)</span>}
              </div>
            )}
            {lastOutcome?.nearMisses && <NearMissIndicator nearMisses={lastOutcome.nearMisses} />}

            <GameBoard
              grid={board.grid}
              lastHitRow={lastOutcome?.cellRow}
              lastHitCol={lastOutcome?.cellCol}
              wildMode={wildMode}
              xRayActive={(board.xray_remaining ?? 0) > 0}
              onWildClick={async (row, col) => {
                if (wildMode) {
                  setWildMode(false);
                  sound.playWildCard();
                  await useWild(row, col);
                }
              }}
            />
            {/* The pre-board screen says "Not enough ROLLS — Buy more"; mid-board
                the identical condition only greyed the dice out and said nothing,
                leaving the unrefunded Abandon link as the sole visible exit. */}
            {!canRoll && board.extra_turns === 0 && (
              <div role="status" className="rounded-lg border border-amber-600/40 bg-amber-950/30 p-3 text-center text-sm text-amber-300">
                Out of ROLLS — your board is saved and waiting.{" "}
                <a href="/shop" className="underline hover:text-amber-100">Get more ROLLS</a>
                <span className="mt-1 block text-xs text-amber-400/70">
                  Levelling up and completing a board both pay ROLLS back.
                </span>
              </div>
            )}

            {wildMode && (
              <div className="text-center text-sm text-yellow-400 animate-pulse">
                🃏 Select a cell to complete with your wild card
                <button onClick={() => setWildMode(false)} className="ml-3 text-gray-500 hover:text-white">Cancel</button>
              </div>
            )}
          </div>

          {/* RIGHT: Controls + notifications */}
          <div className="flex flex-col gap-3">
            {/* Dice FIRST, result under it. RollResult renders a variable number
                of cards — a bare miss is one ~60px box, a roll that lands lines,
                patterns and near-misses together is four — and it used to sit
                above the button, so every roll moved the button 100px+ and a
                player rolling repeatedly was chasing it down the page. */}
            <div className="hidden lg:block">
              <DiceRoller
                onRoll={() => { sound.playRoll(); roll(); }}
                rolling={rolling}
                lastValue={lastOutcome?.dice.value}
                disabled={!canRoll}
                cost={ROLL_COST}
                hasExtra={board.extra_turns > 0}
              />
            </div>

            <RollResult outcome={lastOutcome} />

            {/* Wild card — select a cell to complete */}
            {board.wild_cards > 0 && (
              <button
                onClick={() => setWildMode(!wildMode)}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${wildMode ? "bg-purple-600/40 border-purple-400 text-white" : "bg-purple-600/20 text-purple-300 border-purple-500/40 hover:bg-purple-600/30"}`}
              >
                🃏 {wildMode ? "Selecting..." : `Wild Card (${board.wild_cards})`}
              </button>
            )}

            {/* Power-ups */}
            <PowerUpBar onUse={() => refresh()} boardActive={true} onRefresh={refresh} />

            {/* Abandon */}
            <button onClick={abandonBoard} className="text-xs text-gray-400 hover:text-red-400 transition-colors">
              Abandon Board
            </button>
          </div>
        </div>
      )}

      {/* Cell legend */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-gray-700/40 p-4">
        <h3 className="text-xs text-gray-500 uppercase tracking-wider mb-3">Cells & Bonuses</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs mb-4">
          <Legend emoji="⬜" label="Normal" desc="+10 pts" />
          <Legend emoji="🚀" label="Double" desc="+20 pts" />
          <Legend emoji="🎁" label="Extra" desc="Free roll" />
          <Legend emoji="🃏" label="Wild" desc="Free roll" />
          <Legend emoji="💀" label="Rug Pull" desc="-15 pts" />
          <Legend emoji="🐸" label="Pepe" desc="+25 XP" />
          <Legend emoji="🦦" label="Otter" desc="+15 pts · +30 XP" />
          <Legend emoji="💎" label="Diamond" desc="+30 pts" />
          <Legend emoji="🌙" label="Moon" desc="+50 pts" />
        </div>
        <div className="border-t border-gray-800/50 pt-3">
          <h4 className="text-xs text-yellow-400 font-bold mb-2">Combo Bonuses</h4>
          <div className="grid grid-cols-2 gap-1 text-[10px] text-gray-500">
            <span>Row/Column: +25 pts</span>
            <span>Diagonal: +50 pts</span>
            <span>2 lines at once: x2.5 combo!</span>
            <span>3+ lines: x4+ combo!</span>
            <span>Four Corners: +30 pts</span>
            <span>Full Border: +100 pts</span>
            <span>X Pattern: +80 pts</span>
            <span>BLACKOUT: +500 pts!</span>
          </div>
        </div>
      </div>

      {hasActiveBoard && (
        <MobileRollBar
          onRoll={() => { sound.playRoll(); roll(); }}
          rolling={rolling}
          canRoll={!!canRoll}
          cost={ROLL_COST}
          hasExtra={board.extra_turns > 0}
          outcome={lastOutcome}
          wildMode={wildMode}
          onCancelModes={() => setWildMode(false)}
        />
      )}
    </div>
  );
}

function Legend({ emoji, label, desc }: { emoji: string; label: string; desc: string }) {
  return (
    <div className="flex items-center gap-2">
      <span>{emoji}</span>
      <div>
        <span className="font-medium">{label}</span>
        <span className="text-gray-500 ml-1">{desc}</span>
      </div>
    </div>
  );
}
