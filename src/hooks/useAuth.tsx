"use client";

/**
 * useAuth — ROLA (Radix Off-Ledger Auth) session management.
 *
 * Responsibilities:
 *   - Fetch a server-issued challenge and plug it into the Radix Dapp
 *     Toolkit's challenge generator so account-with-proof flows sign
 *     over it.
 *   - When wallet data arrives with a signedChallenge, post it to
 *     /api/auth/verify and store the resulting opaque session token.
 *   - Persist the session token across reloads (localStorage), expose
 *     it via context, and supply an `authFetch()` helper that attaches
 *     `Authorization: Bearer <token>` to API calls.
 *   - Sign out cleanly (server revoke + local clear).
 *
 * Not in scope here (handled by useWallet):
 *   - wallet connection state
 *   - guest mode
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useWallet } from "./useWallet";
import { API_URL } from "@/lib/constants";
import { apiFetch } from "@/lib/api";
import {
  type Session,
  loadStoredSession,
  storeSession,
  CLOCK_SKEW_BUFFER_SEC,
} from "@/lib/session";

interface AuthState {
  session: Session | null;
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  lastError: string | null;
  signOut: () => Promise<void>;
  /** fetch wrapper that attaches Authorization: Bearer <token> if signed in */
  authFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthState>({
  session: null,
  isAuthenticated: false,
  isAuthenticating: false,
  lastError: null,
  signOut: async () => {},
  // Default (no provider mounted) still attaches the token — apiFetch reads it from
  // storage, so a component outside the provider degrades to "authenticated if a
  // session exists" rather than "silently unauthenticated".
  authFetch: (input, init) => apiFetch(input, init),
});

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { account, rdt, isGuest } = useWallet();
  const [session, setSession] = useState<Session | null>(null);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  // stash the latest challenge we fetched so we can re-use it across the
  // async wallet round-trip — and so we don't fetch a new one per call
  const pendingChallengeRef = useRef<string | null>(null);

  // Load persisted session on mount.
  useEffect(() => {
    const existing = loadStoredSession();
    if (existing) setSession(existing);
  }, []);

  // Drop stored session if the wallet switches to a different address
  // (or disconnects). Guest mode does not participate in ROLA.
  useEffect(() => {
    if (!session) return;
    if (isGuest) {
      storeSession(null);
      setSession(null);
      return;
    }
    if (account && account !== session.address) {
      storeSession(null);
      setSession(null);
    }
  }, [account, isGuest, session]);

  // Wire the Radix Dapp Toolkit challenge generator so the wallet signs
  // over a server-issued challenge when it provides proof.
  useEffect(() => {
    if (!rdt) return;
    const anyRdt = rdt as unknown as {
      walletApi: {
        provideChallengeGenerator?: (gen: () => Promise<string>) => void;
        dataRequestControl?: { provideChallengeGenerator?: (gen: () => Promise<string>) => void };
      };
    };
    const generator = async (): Promise<string> => {
      const c = await fetchChallenge();
      pendingChallengeRef.current = c;
      return c;
    };
    // Depending on RDT version the generator lives in different places.
    anyRdt.walletApi.provideChallengeGenerator?.(generator);
    anyRdt.walletApi.dataRequestControl?.provideChallengeGenerator?.(generator);
  }, [rdt]);

  // Listen for signed-challenge responses from the wallet and trade them
  // for a session token.
  useEffect(() => {
    if (!rdt) return;
    const anyRdt = rdt as unknown as {
      walletApi: {
        walletData$: {
          subscribe: (fn: (data: any) => void) => { unsubscribe: () => void };
        };
      };
    };
    const sub = anyRdt.walletApi.walletData$.subscribe(async (data: any) => {
      const challenges: Array<any> = data?.proofs ?? data?.signedChallenges ?? [];
      const accountChallenge = challenges.find(
        (c) => c?.type === "account" && c?.address && c?.proof
      );
      if (!accountChallenge) return;
      if (
        session &&
        session.address === accountChallenge.address &&
        session.expiresAt - CLOCK_SKEW_BUFFER_SEC > Math.floor(Date.now() / 1000)
      ) {
        return; // already authenticated for this address
      }
      await verifyAndStore(accountChallenge);
    });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rdt, session?.address]);

  const verifyAndStore = useCallback(async (signedChallenge: any) => {
    setIsAuthenticating(true);
    setLastError(null);
    try {
      const res = await fetch(`${API_URL}/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signedChallenge,
          origin: typeof window !== "undefined" ? window.location.origin : "",
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error ?? `verify failed (${res.status})`);
      }
      const s: Session = {
        token: data.token,
        address: data.address,
        expiresAt: data.expiresAt,
      };
      storeSession(s);
      setSession(s);
    } catch (err: any) {
      setLastError(err?.message ?? String(err));
    } finally {
      setIsAuthenticating(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    const current = session;
    storeSession(null);
    setSession(null);
    if (!current) return;
    try {
      await fetch(`${API_URL}/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${current.token}` },
      });
    } catch {
      /* non-fatal — local state already cleared */
    }
  }, [session]);

  // Exactly one place attaches the Authorization header: the module-level apiFetch.
  // It reads the token from storage at call time, so this needs no React state and
  // is referentially stable — no useCallback, and consumers still re-render on
  // sign-in/sign-out via `session` in the context value below.
  const authFetch = apiFetch;

  const value = useMemo<AuthState>(
    () => ({
      session,
      isAuthenticated: !!session,
      isAuthenticating,
      lastError,
      signOut,
      authFetch,
    }),
    [session, isAuthenticating, lastError, signOut, authFetch]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// ── Helpers ─────────────────────────────────────────────────────────

async function fetchChallenge(): Promise<string> {
  const res = await fetch(`${API_URL}/auth/challenge`, { method: "POST" });
  if (!res.ok) throw new Error(`challenge fetch ${res.status}`);
  const data = await res.json();
  if (typeof data?.challenge !== "string") throw new Error("malformed challenge response");
  return data.challenge;
}
