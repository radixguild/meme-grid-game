import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { updateStreak, getStreakReward } from "../streaks";

describe("updateStreak", () => {
  it("starts at 1 for first play", () => {
    const result = updateStreak(0, 0, null);
    assert.equal(result.newStreak, 1);
    assert.equal(result.newLongest, 1);
  });

  it("increments on consecutive day", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const result = updateStreak(5, 5, yesterday.toISOString().split("T")[0]);
    assert.equal(result.newStreak, 6);
    assert.equal(result.newLongest, 6);
  });

  it("no change if already played today", () => {
    const today = new Date().toISOString().split("T")[0];
    const result = updateStreak(3, 5, today);
    assert.equal(result.newStreak, 3);
    assert.equal(result.newLongest, 5);
  });

  it("graceful decay — 2 days missed loses 2 streak", () => {
    const threeDaysAgo = new Date();
    threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
    const result = updateStreak(10, 10, threeDaysAgo.toISOString().split("T")[0]);
    // daysMissed = 3 - 1 = 2, newStreak = max(1, 10-2) = 8
    assert.equal(result.newStreak, 8);
  });

  it("graceful decay — never below 1", () => {
    const sixDaysAgo = new Date();
    sixDaysAgo.setDate(sixDaysAgo.getDate() - 6);
    const result = updateStreak(2, 5, sixDaysAgo.toISOString().split("T")[0]);
    // daysMissed = 5, newStreak = max(1, 2-5) = 1
    assert.equal(result.newStreak, 1);
  });

  it("resets after 7+ days away", () => {
    const tenDaysAgo = new Date();
    tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);
    const result = updateStreak(20, 20, tenDaysAgo.toISOString().split("T")[0]);
    assert.equal(result.newStreak, 1);
    assert.equal(result.newLongest, 20); // longest preserved
  });

  it("updates longest when beating record", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const result = updateStreak(9, 9, yesterday.toISOString().split("T")[0]);
    assert.equal(result.newStreak, 10);
    assert.equal(result.newLongest, 10);
  });

  it("preserves longest on decay", () => {
    const fiveDaysAgo = new Date();
    fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);
    const result = updateStreak(3, 15, fiveDaysAgo.toISOString().split("T")[0]);
    assert.equal(result.newLongest, 15);
  });
});

describe("getStreakReward", () => {
  // Streaks pay XP bonuses and power-ups. They pay NO ROLLS, at any tier, and that
  // is the point rather than an oversight: a ROLL is a receipt for work, and a daily
  // check-in is not work. It was also the farm vector — the old streak-30 tier gave a
  // single address 205 ROLLS a day forever, which converted to meme-coins through
  // lucky drops. If a freeMeme or freeRolls assertion below ever goes back above
  // zero, that faucet is open again.
  it("pays no ROLLS at the first tier", () => {
    const reward = getStreakReward(1);
    assert.equal(reward.freeMeme, 0);
    assert.equal(reward.freeRolls, 0);
    assert.equal(reward.powerUp, null);
  });

  it("pays no ROLLS at any tier, including the highest", () => {
    for (const streak of [1, 2, 3, 5, 7, 14, 30, 100]) {
      const reward = getStreakReward(streak);
      assert.equal(reward.freeMeme, 0, `streak ${streak} must credit no ROLLS`);
      assert.equal(reward.freeRolls, 0, `streak ${streak} must credit no free rolls`);
    }
  });

  it("still escalates the XP bonus, which is motivation and not currency", () => {
    assert.equal(getStreakReward(1).bonusXpPercent, 0);
    assert.equal(getStreakReward(7).bonusXpPercent, 20);
    assert.equal(getStreakReward(30).bonusXpPercent, 50);
  });

  it("still awards power-ups, which cannot leave the game", () => {
    assert.equal(getStreakReward(5).powerUp, "reroll");
    assert.equal(getStreakReward(7).powerUp, "x_ray");
    assert.equal(getStreakReward(30).powerUp, "row_bomb");
  });

  it("day 100 still resolves to the day 30 tier", () => {
    assert.equal(getStreakReward(100).bonusXpPercent, 50);
    assert.equal(getStreakReward(100).powerUp, "row_bomb");
  });
});
