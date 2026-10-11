/**
 * apiFetch — drop-in `fetch` replacement that attaches the ROLA session token.
 *
 * Why this exists: the server gates game/token routes behind ROLA. The env
 * default, `ROLA_AUTH_MODE=legacy`, trusts the address in the URL; the routes that
 * fund, mint or spend for a real `account_…` address pin
 * `requireAuth({ mode: "required-for-wallets" })` per route instead, and that 401s
 * a wallet request with no bearer token. Guests never hold a ROLA session and stay
 * on the legacy path, so `ROLA_AUTH_MODE` must NOT be flipped to `required`
 * globally: a guest can never pass `required`, so that would break guest play.
 * Every client call therefore goes through here, so a wallet's session token
 * travels with every request that a per-route gate may check.
 *
 * Reads the token at CALL time rather than closing over React state, so it cannot
 * send a stale token after a sign-in, sign-out or refresh, and it works from plain
 * modules as well as components.
 *
 * Signature matches `fetch`, so migrating a call site is `fetch(` -> `apiFetch(`.
 * Sending a token to a public endpoint is harmless — the server ignores it.
 */

import { currentToken } from "./session";

export function apiFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? undefined);
  const token = currentToken();
  // Never clobber an Authorization header a caller set deliberately.
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}

/**
 * True when the client currently holds a session. Use to decide whether an action
 * behind a `required-for-wallets` route is available, rather than checking
 * wallet-connection state — a connected wallet is not the same as a proven one.
 */
export function hasSession(): boolean {
  return currentToken() !== null;
}
