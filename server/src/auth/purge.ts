/**
 * Periodic purge of dead auth rows (MG-5, 2026-10-06).
 *
 * challenge.ts and session.ts each had a purgeExpired(), but nothing called
 * either. POST /api/auth/challenge is unauthenticated and inserts a row per call,
 * so at the 60 POST/min per-IP limit one client added ~86k permanent rows a day
 * to a SQLite file on a shared box. index.ts now starts this timer at boot.
 */

import { purgeExpired as purgeExpiredChallenges } from "./challenge";
import { purgeExpired as purgeExpiredSessions } from "./session";

export const AUTH_PURGE_INTERVAL_MS = 10 * 60 * 1000;

export interface AuthPurgeResult {
  /** Rows removed, or null when that purge threw (already logged). */
  challenges: number | null;
  sessions: number | null;
}

/** Run both purges. Never throws: a failed purge is logged and reported as null. */
export function purgeAuthTables(): AuthPurgeResult {
  const run = (name: string, fn: () => number): number | null => {
    try {
      return fn();
    } catch (err: any) {
      console.error(`[auth-purge] ${name} purge failed: ${err?.message ?? err}`);
      return null;
    }
  };
  return {
    challenges: run("challenge", purgeExpiredChallenges),
    sessions: run("session", purgeExpiredSessions),
  };
}

/**
 * Purge once now, then every `intervalMs`. The timer is unref'd so it never
 * holds the process open. Returns it so a caller (or a test) can clear it.
 */
export function startAuthPurge(intervalMs: number = AUTH_PURGE_INTERVAL_MS): NodeJS.Timeout {
  purgeAuthTables();
  const timer = setInterval(purgeAuthTables, intervalMs);
  timer.unref();
  return timer;
}
