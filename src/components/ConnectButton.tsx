"use client";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { DAPP_DEF } from "@/lib/constants";

/**
 * In-page "Connect Wallet" affordance.
 *
 * Deliberately NOT a second `<radix-connect-button>`: RDT binds to the first
 * such element in the document and only that one, so every extra copy renders
 * as a dead web component. That was the original mobile bug.
 *
 * Instead this delegates to the single bound button in the header by dispatching
 * the very "onConnect" event that button emits — RDT listens for it with
 * `fromEvent(connectButtonElement, "onConnect")`.
 *
 * Why not call `rdt.walletApi.sendRequest()` directly: RDT's own onConnect
 * handler runs `stateModule.reset()` and then `sendRequest({ isConnect: true })`.
 * The public `walletApi.sendRequest()` hardcodes `isConnect: false` and skips the
 * reset, so `canDataRequestBeResolvedByRdtState()` can satisfy it straight from
 * cached RDT state and resolve without ever reaching the wallet — a Connect
 * button that silently does nothing, which is the bug we are fixing.
 */
export default function ConnectButton({ className = "" }: { className?: string }) {
  const { rdt } = useWallet();
  const [status, setStatus] = useState<string>("default");

  // Mirror RDT's own button status rather than latching local state. RDT's
  // pending request has no timeout, so a local `pending` flag set on click would
  // never clear when the wallet never answers (no wallet installed, user backs
  // out of the deep link, no connector extension) — leaving a permanently
  // disabled button. Here the label follows RDT, and the button never disables
  // on pending, so it always stays clickable.
  useEffect(() => {
    if (!rdt) return;
    const sub = rdt.buttonApi.status$.subscribe((s) => setStatus(String(s)));
    return () => sub.unsubscribe();
  }, [rdt]);

  const connect = useCallback(() => {
    const el = document.querySelector("radix-connect-button");
    if (!el) return;
    el.dispatchEvent(new CustomEvent("onConnect"));
  }, []);

  // Gate on the build-time constant, not on `rdt`. `rdt` is null through SSR and
  // the first client render, so keying off it would paint a greyed-out button on
  // every cold load and blame a missing dApp definition that is in fact present.
  const unavailable = !DAPP_DEF;

  return (
    <button
      type="button"
      onClick={connect}
      disabled={unavailable}
      title={unavailable ? "Wallet connect unavailable — dApp definition not configured" : undefined}
      className={
        "px-6 py-3 rounded-xl font-semibold text-black bg-gradient-to-br from-[var(--neon-green)] to-[var(--neon-cyan)] " +
        "transition-all hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 " +
        className
      }
    >
      {status === "pending" ? "Check your wallet…" : "Connect Wallet"}
    </button>
  );
}
