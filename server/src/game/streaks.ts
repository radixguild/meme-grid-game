// Streak system — daily play streaks with graceful decay

export interface StreakInfo {
  currentStreak: number;
  longestStreak: number;
  lastPlayDate: string; // YYYY-MM-DD
  streakBonus: number; // bonus XP multiplier percentage
  streakReward: StreakReward;
}

export interface StreakReward {
  bonusXpPercent: number;
  freeMeme: number;
  freeRolls: number;
  powerUp: string | null;
}

// Streak reward tiers — XP bonuses and power-ups escalate; ROLLS do not, and are 0
// at every tier deliberately.
//
// A ROLL is meant to be a receipt for work: you do a few hours, you earn a burst of
// about four, you roll them, you go back to work. A daily check-in is not work, so
// paying ROLLS for one both contradicts the mechanic and is the farm vector — at the
// old streak-30 tier a single address drew 205 ROLLS a day forever, which at ~2
// boards a day converted into roughly 111 meme-coins a day through lucky drops.
// Addresses are cheap; that faucet was the whole attack.
//
// XP bonuses and power-ups stay: both are motivational and neither leaves the game.
// Power-ups do help a board finish sooner, which is a small subsidy on the one thing
// that pays — accepted knowingly, because it is bounded by the board itself.
const STREAK_REWARDS: Record<number, StreakReward> = {
  1: { bonusXpPercent: 0, freeMeme: 0, freeRolls: 0, powerUp: null },
  2: { bonusXpPercent: 5, freeMeme: 0, freeRolls: 0, powerUp: null },
  3: { bonusXpPercent: 10, freeMeme: 0, freeRolls: 0, powerUp: null },
  5: { bonusXpPercent: 15, freeMeme: 0, freeRolls: 0, powerUp: "reroll" },
  7: { bonusXpPercent: 20, freeMeme: 0, freeRolls: 0, powerUp: "x_ray" },
  14: { bonusXpPercent: 30, freeMeme: 0, freeRolls: 0, powerUp: "magnet" },
  30: { bonusXpPercent: 50, freeMeme: 0, freeRolls: 0, powerUp: "row_bomb" },
};

export function getStreakReward(streak: number): StreakReward {
  let best: StreakReward = { bonusXpPercent: 0, freeMeme: 0, freeRolls: 0, powerUp: null };
  for (const [threshold, reward] of Object.entries(STREAK_REWARDS)) {
    if (streak >= parseInt(threshold, 10)) best = reward;
  }
  return best;
}

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}

function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}

/**
 * Calculate updated streak based on last play date.
 * Graceful decay: miss 1 day = lose 1 from streak (not reset to 0).
 * Miss 2+ days = lose 2. Miss 7+ days = reset to 0.
 */
export function updateStreak(
  currentStreak: number,
  longestStreak: number,
  lastPlayDate: string | null
): { newStreak: number; newLongest: number; todayDate: string } {
  const today = getToday();
  const yesterday = getYesterday();

  if (!lastPlayDate) {
    // First ever play
    return { newStreak: 1, newLongest: 1, todayDate: today };
  }

  if (lastPlayDate === today) {
    // Already played today — no change
    return { newStreak: currentStreak, newLongest: longestStreak, todayDate: today };
  }

  if (lastPlayDate === yesterday) {
    // Consecutive day!
    const newStreak = currentStreak + 1;
    return {
      newStreak,
      newLongest: Math.max(longestStreak, newStreak),
      todayDate: today,
    };
  }

  // Missed days — graceful decay
  const lastDate = new Date(lastPlayDate);
  const todayDate = new Date(today);
  const daysMissed = Math.floor((todayDate.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24)) - 1;

  if (daysMissed >= 7) {
    // Reset after a week away
    return { newStreak: 1, newLongest: longestStreak, todayDate: today };
  }

  // Graceful decay: lose streak points for days missed, minimum 1
  const newStreak = Math.max(1, currentStreak - daysMissed);
  return {
    newStreak,
    newLongest: longestStreak,
    todayDate: today,
  };
}
