"use client";
import { useEffect, useState, useCallback, createContext, useContext } from "react";
import { RadixDappToolkit, RadixNetwork, DataRequestBuilder } from "@radixdlt/radix-dapp-toolkit";
import { API_URL, DAPP_DEF, NETWORK } from "@/lib/constants";

interface WalletState {
  account: string | null;
  connected: boolean;
  isGuest: boolean;
  rdt: RadixDappToolkit | null;
  /** Resolves true once a guest session exists. False means it failed — read `guestError`. */
  playAsGuest: () => Promise<boolean>;
  disconnectGuest: () => void;
  /** Why the last playAsGuest() failed (quota reached, server unreachable). */
  guestError: string | null;
  /** A guest id request is in flight — disable the button rather than double-spending the quota. */
  guestPending: boolean;
}

const WalletContext = createContext<WalletState>({
  account: null,
  connected: false,
  isGuest: false,
  rdt: null,
  playAsGuest: async () => false,
  disconnectGuest: () => {},
  guestError: null,
  guestPending: false,
});

export function useWallet() {
  return useContext(WalletContext);
}

const GUEST_KEY = "meme-grid-guest-id";

/**
 * Ask the server for a guest identity.
 *
 * This used to be `"guest_" + Math.random()` generated right here, which the
 * server accepted on shape alone — so a cleared tab was a brand-new account
 * holding another 500 free MEME, unbounded (docs/GAME-DESIGN-REVIEW.md §5).
 * Guest ids are now issued and signed server-side and metered per IP; the
 * client's job is to ask for one and remember it.
 *
 * Still sessionStorage, not localStorage: the id is deliberately tab-scoped so
 * a guest is nudged toward connecting a wallet for anything persistent. That is
 * a product choice, and it is no longer the security boundary it was standing
 * in for.
 */
async function requestGuestId(): Promise<{ id: string } | { error: string }> {
  try {
    const res = await fetch(`${API_URL}/guest/new`, { method: "POST" });
    const data = await res.json().catch(() => null);

    if (res.ok && data?.ok && typeof data.guest_id === "string") {
      return { id: data.guest_id };
    }
    // The server's message is the useful one (it names the quota and points at
    // the wallet path) — only invent text when there wasn't one.
    return {
      error:
        typeof data?.error === "string"
          ? data.error
          : `Could not start a guest session (HTTP ${res.status}). Try again in a moment.`,
    };
  } catch {
    return { error: "Could not reach the game server. Check your connection and try again." };
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [isGuest, setIsGuest] = useState(false);
  // State, not a ref: consumers (ConnectButton, useAuth, shop) need `rdt` to be
  // readable *before* a connection exists, and a ref assignment never triggers
  // the re-render that would publish it through context.
  const [rdt, setRdt] = useState<RadixDappToolkit | null>(null);
  const [guestError, setGuestError] = useState<string | null>(null);
  const [guestPending, setGuestPending] = useState(false);

  const playAsGuest = useCallback(async (): Promise<boolean> => {
    setGuestError(null);

    // Reuse the tab's existing id rather than spending another slot from this
    // IP's daily quota — a second click must not cost a guest their session.
    const existing = sessionStorage.getItem(GUEST_KEY);
    if (existing) {
      setAccount(existing);
      setIsGuest(true);
      return true;
    }

    setGuestPending(true);
    try {
      const result = await requestGuestId();
      if ("error" in result) {
        setGuestError(result.error);
        return false;
      }
      sessionStorage.setItem(GUEST_KEY, result.id);
      setAccount(result.id);
      setIsGuest(true);
      return true;
    } finally {
      setGuestPending(false);
    }
  }, []);

  const disconnectGuest = useCallback(() => {
    setAccount(null);
    setIsGuest(false);
    setGuestError(null);
    sessionStorage.removeItem(GUEST_KEY);
  }, []);

  useEffect(() => {
    // Check if already in guest mode
    const existingGuest = sessionStorage.getItem(GUEST_KEY);
    if (existingGuest) {
      setAccount(existingGuest);
      setIsGuest(true);
    }

    if (!DAPP_DEF) {
      // Env missing — fall back to guest-only mode rather than initializing
      // RDT against an empty dApp definition (which mis-routes mobile wallet
      // connect). Log loudly so this is obvious in dev consoles.
      console.error(
        "[useWallet] NEXT_PUBLIC_DAPP_DEF is not set — Radix Connect disabled. Set it in env to enable wallet connect."
      );
      return;
    }

    try {
      const networkId = NETWORK === "stokenet" ? RadixNetwork.Stokenet : RadixNetwork.Mainnet;
      const rdt = RadixDappToolkit({
        dAppDefinitionAddress: DAPP_DEF,
        networkId,
        applicationName: "MEME GRID",
        applicationVersion: "0.1.0",
      });
      // Ask for a signed proof of ownership on both persona and account, not
      // just the address. Proof-less accounts (the request this replaced)
      // is exactly what left ROLA inert (docs/PROJECT-STATE.md item 3): the
      // wallet handed over an address without ever being asked to sign
      // anything, so no session was ever issued. useAuth's effect (this
      // provider's child in app/providers.tsx) is what turns a returned
      // proof into a session — it registers the challenge generator RDT
      // calls when it needs one, then posts the signed challenge to
      // /api/auth/verify.
      //
      // Ordering note: useAuth registers its generator in an effect keyed on
      // `rdt`, which only fires on the render AFTER `setRdt` below propagates
      // through context — one render later than this call. RDT only invokes
      // the generator lazily, when it actually sends a wallet request (e.g.
      // on the user clicking Connect), so a fresh connection is unaffected.
      // The one case this can catch cold is a wallet that was already linked
      // before this change shipped and auto-refreshes on load before the
      // generator is registered: that one round-trip may come back proof-less
      // and get no session. It self-heals on the next explicit
      // connect/reconnect, which is the documented "reconnect once" rollout
      // note in PROJECT-STATE.md item 3 — not a bug to route around here.
      rdt.walletApi.setRequestData(
        DataRequestBuilder.persona().withProof(),
        DataRequestBuilder.accounts().atLeast(1).withProof()
      );
      const sub = rdt.walletApi.walletData$.subscribe((data) => {
        const accts = data?.accounts ?? [];
        const addr = accts[0]?.address ?? null;
        if (addr) {
          setAccount(addr);
          setIsGuest(false);
        } else {
          // Wallet disconnected. Clear the wallet account but never clobber
          // guest mode — walletData$ also emits an empty state on init.
          setAccount((prev) => (prev && !prev.startsWith("guest_") ? null : prev));
        }
      });
      setRdt(rdt);

      // Guard against the mobile "Connect does nothing" regression: RDT binds
      // to `document.querySelector("radix-connect-button")` — the FIRST match
      // and only that one. A second copy (e.g. a breakpoint-hidden duplicate)
      // renders as a dead element. Use <ConnectButton /> for extra call sites.
      if (process.env.NODE_ENV !== "production") {
        const n = document.querySelectorAll("radix-connect-button").length;
        if (n > 1) {
          console.error(
            `[useWallet] ${n} <radix-connect-button> elements found — RDT only binds the first. ` +
              `The others are inert. Keep one (in app/layout.tsx) and use <ConnectButton /> elsewhere.`
          );
        }
      }

      return () => {
        sub.unsubscribe();
        rdt.destroy();
        setRdt(null);
      };
    } catch (err) {
      // Guest mode still works if RDT can't start, but never swallow the reason
      // silently — a mute failure here is indistinguishable from a dead button.
      console.error("[useWallet] Radix Connect failed to initialize:", err);
    }
  }, []);

  return (
    <WalletContext.Provider
      value={{ account, connected: !!account, isGuest, rdt, playAsGuest, disconnectGuest, guestError, guestPending }}
    >
      {children}
    </WalletContext.Provider>
  );
}
