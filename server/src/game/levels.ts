export interface Level {
  level: number;
  name: string;
  emoji: string;
  xp: number;
}

export const LEVELS: Level[] = [
  { level: 1, name: "Normie", emoji: "\ud83d\udc64", xp: 0 },
  { level: 2, name: "Lurker", emoji: "\ud83d\udc40", xp: 2000 },
  { level: 3, name: "Degen", emoji: "\ud83c\udfb0", xp: 6000 },
  { level: 4, name: "Diamond Hands", emoji: "\ud83d\udc8e", xp: 15000 },
  { level: 5, name: "Whale", emoji: "\ud83d\udc33", xp: 30000 },
  { level: 6, name: "Chad", emoji: "\ud83d\uddff", xp: 55000 },
  { level: 7, name: "Gigabrain", emoji: "\ud83e\udde0", xp: 90000 },
  { level: 8, name: "Based", emoji: "\ud83c\udfe2", xp: 140000 },
  { level: 9, name: "Sigma", emoji: "\u26a1", xp: 210000 },
  { level: 10, name: "Meme Lord", emoji: "\ud83d\udc51", xp: 300000 },
];

export function getLevel(xp: number): Level {
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (xp >= LEVELS[i].xp) return LEVELS[i];
  }
  return LEVELS[0];
}

export function getNextLevelXp(xp: number): number | null {
  const current = getLevel(xp);
  const next = LEVELS.find((l) => l.level === current.level + 1);
  return next ? next.xp : null;
}
