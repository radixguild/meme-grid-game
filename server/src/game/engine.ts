// Core game engine — pure functions, no DB dependencies

import { type Cell, CELL_TYPES, GRID_SIZE } from "./grid";
import { rollDice, type DiceResult } from "./dice";
import { randomIndex } from "./secure-random";
import { checkNewLines, checkPatterns, getComboMultiplier, getNearMisses, type LineBonus, type PatternBonus } from "./patterns";

export interface RollOutcome {
  dice: DiceResult;
  cellRow: number;
  cellCol: number;
  cellType: string;
  oldHits: number;
  newHits: number;
  cellCompleted: boolean;
  scoreChange: number;
  xpEarned: number;
  extraTurn: boolean;
  wildCardEarned: boolean;
  boardCompleted: boolean;
  message: string;
  // Phase 3 additions
  lines: LineBonus[];
  patterns: PatternBonus[];
  comboMultiplier: number;
  lineBonusScore: number;
  lineBonusXp: number;
  nearMisses: Array<{ type: string; remaining: { row: number; col: number } }>;
  pityBonusXp: number;
}

/**
 * Is every cell on this board complete?
 *
 * Exported because `routes/powerups.ts` needs the same answer `processRoll` computes
 * internally. Row Bomb completed cells and incremented `cells_completed` but never
 * asked this question, so a board finished by a bomb stayed `status: "active"` with
 * 64/64 cells — no drops, no achievements, and `processRoll` throwing "Board is
 * already completed" on every subsequent roll. Two routes inferring completion two
 * different ways is what allowed that; now there is one predicate.
 */
export function isBoardComplete(grid: Cell[][]): boolean {
  return getIncompleteCells(grid).length === 0;
}

function getIncompleteCells(grid: Cell[][]): Array<{ row: number; col: number }> {
  const cells: Array<{ row: number; col: number }> = [];
  for (let r = 0; r < GRID_SIZE; r++) {
    for (let c = 0; c < GRID_SIZE; c++) {
      if (!grid[r][c].completed) cells.push({ row: r, col: c });
    }
  }
  // Fisher-Yates shuffle for true randomness
  for (let i = cells.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return cells;
}

/**
 * Pity system: rolls without a cell completion increase bonus XP.
 * Every 5 misses = +10 bonus XP on next hit. Resets on cell completion.
 */
function getPityBonus(pityCounter: number): number {
  return Math.floor(pityCounter / 5) * 10;
}

export function processRoll(grid: Cell[][], pityCounter = 0, magnetActive = false): RollOutcome {
  const dice = rollDice();
  const incomplete = getIncompleteCells(grid);

  if (incomplete.length === 0) {
    throw new Error("Board is already completed");
  }

  // Pick target cell — magnet prioritizes cells closest to completion
  let target;
  if (magnetActive && incomplete.length > 1) {
    const sorted = incomplete.sort((a, b) => {
      const cellA = grid[a.row][a.col];
      const cellB = grid[b.row][b.col];
      return (cellB.hits / cellB.threshold) - (cellA.hits / cellA.threshold);
    });
    const pool = sorted.slice(0, Math.min(3, sorted.length));
    target = pool[randomIndex(pool.length)];
  } else {
    target = incomplete[randomIndex(incomplete.length)];
  }
  const cell = grid[target.row][target.col];
  const config = CELL_TYPES[cell.type];

  const oldHits = cell.hits;
  cell.hits += 1;
  const cellCompleted = cell.hits >= cell.threshold;
  if (cellCompleted) cell.completed = true;

  let scoreChange = 0;
  let xpEarned = 0;
  let extraTurn = false;
  let wildCardEarned = false;
  let message = "";
  let pityBonusXp = 0;

  if (cellCompleted) {
    scoreChange = config.reward;
    xpEarned = config.xp + dice.bonusXp;

    // Apply pity bonus on completion
    pityBonusXp = getPityBonus(pityCounter);
    xpEarned += pityBonusXp;

    switch (cell.type) {
      case "extra_turn":
        extraTurn = true;
        message = `Extra turn! ${config.emoji} Roll refunded.`;
        break;
      case "wild":
        wildCardEarned = true;
        message = `Wild card earned! ${config.emoji} Choose any cell next.`;
        break;
      case "rug_pull":
        // Rug pulls still hurt, but less — minimum +2 XP always
        xpEarned = Math.max(2, xpEarned);
        message = `Rug pull! ${config.emoji} Lost ${Math.abs(scoreChange)} pts, but earned ${xpEarned} XP.`;
        break;
      case "diamond":
        message = `Diamond jackpot! ${config.emoji} +${scoreChange} pts!`;
        break;
      case "moon":
        message = `MOON! ${config.emoji} +${scoreChange} pts & +${xpEarned} XP!`;
        break;
      case "double_score":
        message = `Double score! ${config.emoji} +${scoreChange} pts!`;
        break;
      case "pepe_bonus":
        message = `Pepe bonus! ${config.emoji} +${xpEarned} XP!`;
        break;
      case "otter":
        message = `Purple otter! ${config.emoji} +${scoreChange} pts & +${xpEarned} XP!`;
        break;
      default:
        message = `Cell completed! +${scoreChange} pts.`;
    }
  } else {
    // ALWAYS give something — minimum 1 XP per roll + dice bonus
    xpEarned = Math.max(1, dice.bonusXp);
    message = `Hit! ${cell.hits}/${cell.threshold} on ${config.emoji}. Dice: ${dice.label}`;
  }

  // Check for line completions
  let lines: LineBonus[] = [];
  let patterns: PatternBonus[] = [];
  let comboMultiplier = 1;
  let lineBonusScore = 0;
  let lineBonusXp = 0;

  if (cellCompleted) {
    lines = checkNewLines(grid, target.row, target.col);
    if (lines.length > 0) {
      comboMultiplier = getComboMultiplier(lines.length);
      for (const line of lines) {
        lineBonusScore += Math.floor(line.reward * comboMultiplier);
        lineBonusXp += Math.floor(line.xp * comboMultiplier);
      }
      scoreChange += lineBonusScore;
      xpEarned += lineBonusXp;

      if (lines.length >= 2) {
        message += ` COMBO x${comboMultiplier}!`;
      } else {
        message += ` ${lines[0].label}`;
      }
    }

    // Check patterns (only on completion events, and only those the completed
    // cell just made true — see checkPatterns)
    patterns = checkPatterns(grid, target.row, target.col);
    for (const pattern of patterns) {
      scoreChange += pattern.reward;
      xpEarned += pattern.xp;
      message += ` ${pattern.emoji} ${pattern.label}`;
    }
  }

  // Detect near misses for UI excitement
  const nearMisses = cellCompleted ? getNearMisses(grid) : [];

  const boardCompleted = getIncompleteCells(grid).length === 0;

  // Cap XP per roll to prevent overflow (max 2000 per roll)
  xpEarned = Math.min(xpEarned, 2000);
  // Cap score change per roll
  scoreChange = Math.max(-100, Math.min(scoreChange, 5000));

  return {
    dice,
    cellRow: target.row,
    cellCol: target.col,
    cellType: cell.type,
    oldHits: oldHits,
    newHits: cell.hits,
    cellCompleted,
    scoreChange,
    xpEarned,
    extraTurn,
    wildCardEarned,
    boardCompleted,
    message,
    lines,
    patterns,
    comboMultiplier,
    lineBonusScore,
    lineBonusXp,
    nearMisses,
    pityBonusXp,
  };
}

export function processWild(grid: Cell[][], row: number, col: number): RollOutcome {
  if (row < 0 || row >= GRID_SIZE || col < 0 || col >= GRID_SIZE) {
    throw new Error("Cell position out of bounds");
  }

  const cell = grid[row][col];
  if (cell.completed) {
    throw new Error("Cell is already completed");
  }

  const config = CELL_TYPES[cell.type];
  const oldHits = cell.hits;

  cell.hits = cell.threshold;
  cell.completed = true;

  let scoreChange = config.reward;
  let xpEarned = config.xp;
  let lineBonusScore = 0;
  let lineBonusXp = 0;

  // Check for line completions from wild card
  const lines = checkNewLines(grid, row, col);
  const comboMultiplier = getComboMultiplier(lines.length);
  for (const line of lines) {
    lineBonusScore += Math.floor(line.reward * comboMultiplier);
    lineBonusXp += Math.floor(line.xp * comboMultiplier);
  }
  scoreChange += lineBonusScore;
  xpEarned += lineBonusXp;

  const patterns = checkPatterns(grid, row, col);
  for (const pattern of patterns) {
    scoreChange += pattern.reward;
    xpEarned += pattern.xp;
  }

  const boardCompleted = getIncompleteCells(grid).length === 0;
  let message = `Wild card used! ${config.emoji} +${scoreChange} pts.`;
  if (lines.length > 0) message += ` ${lines.map((l) => l.label).join(" ")}`;

  return {
    dice: { value: 0, label: "Wild", bonusXp: 0 },
    cellRow: row,
    cellCol: col,
    cellType: cell.type,
    oldHits,
    newHits: cell.threshold,
    cellCompleted: true,
    scoreChange,
    xpEarned,
    extraTurn: false,
    wildCardEarned: false,
    boardCompleted,
    message,
    lines,
    patterns,
    comboMultiplier,
    lineBonusScore,
    lineBonusXp,
    nearMisses: getNearMisses(grid),
    pityBonusXp: 0,
  };
}
