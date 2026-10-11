/**
 * Session storage — the single definition of how a ROLA session is persisted and
 * when it counts as expired.
 *
 * Extracted from useAuth so that `lib/api.ts` can read the token at call time
 * without importing React context. Two copies of the expiry rule would drift
 * apart, which is the failure mode that put a stale roll price in two files.
 */

export interface Session {
  token: string;
  address: string;
  /** unix seconds */
  expiresAt: number;
}

export const SESSION_STORAGE_KEY = "meme-grid-session";

/** Treat a session as expired this long before real expiry, to absorb clock skew. */
export const CLOCK_SKEW_BUFFER_SEC = 60;

/** Reads the stored session, clearing it if malformed or (nearly) expired. */
export function loadStoredSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    if (
      typeof parsed?.token !== "string" ||
      typeof parsed?.address !== "string" ||
      typeof parsed?.expiresAt !== "number"
    ) {
      return null;
    }
    if (parsed.expiresAt - CLOCK_SKEW_BUFFER_SEC < Math.floor(Date.now() / 1000)) {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function storeSession(s: Session | null): void {
  if (typeof window === "undefined") return;
  if (s) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(s));
  else localStorage.removeItem(SESSION_STORAGE_KEY);
}

/** The bearer token if there is a live session, else null. */
export function currentToken(): string | null {
  return loadStoredSession()?.token ?? null;
}
