/**
 * src/lib/api.ts — apiFetch is how every API call picks up the stored ROLA
 * bearer token (useAuth's authFetch is apiFetch, with or without a provider
 * mounted). The one call that sets the header itself is useAuth's logout, which
 * sends the token it is revoking after storage has already been cleared.
 * hasSession answers "does this client hold a proven session", which is not the
 * same question as "is a wallet connected".
 *
 * fetch is replaced with a mock that records what it was called with, so these
 * tests see exactly the request apiFetch would put on the wire. Runs under
 * `tsx --test`, outside Next's bundler; see ./browser-globals for the window and
 * localStorage stand-ins, and session.test.ts for the expiry rule itself.
 */

import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import { apiFetch, hasSession } from "../api";
import {
  CLOCK_SKEW_BUFFER_SEC,
  SESSION_STORAGE_KEY,
  currentToken,
  storeSession,
  type Session,
} from "../session";
import { installBrowserGlobals, type BrowserGlobals } from "./browser-globals";
import { MAINNET_ACCOUNTS } from "../../../server/src/__tests__/fixtures/addresses";

const NOW_SEC = 1_790_000_000;
// 64 hex chars, the shape the server issues. Low-entropy on purpose: a random-
// looking literal in a variable named TOKEN trips gitleaks' generic-api-key rule.
const TOKEN = "ab".repeat(32);
const OTHER = "cd".repeat(32);

function sessionExpiringIn(seconds: number, token = TOKEN): Session {
  return { token, address: MAINNET_ACCOUNTS[0], expiresAt: NOW_SEC + seconds };
}

let env: BrowserGlobals;
let fetchMock: ReturnType<typeof mock.method<typeof globalThis, "fetch">>;

before(() => {
  env = installBrowserGlobals();
});

after(() => {
  env.uninstall();
});

beforeEach(() => {
  env.storage.clear();
  mock.method(Date, "now", () => NOW_SEC * 1000);
  fetchMock = mock.method(globalThis, "fetch", async () => new Response("{}", { status: 200 }));
});

afterEach(() => {
  mock.restoreAll();
});

/** The arguments of the most recent fetch call. */
function lastCall(): { input: unknown; init: RequestInit | undefined } {
  const calls = fetchMock.mock.calls;
  assert.ok(calls.length > 0, "fetch was never called");
  const [input, init] = calls[calls.length - 1].arguments;
  return { input, init };
}

function sentAuthorization(): string | null {
  return new Headers(lastCall().init?.headers).get("Authorization");
}

describe("apiFetch", () => {
  test("sends no Authorization header without a session", async () => {
    await apiFetch("/api/player/x");
    assert.equal(lastCall().input, "/api/player/x");
    assert.equal(sentAuthorization(), null);
  });

  test("attaches 'Bearer <token>' for a live session", async () => {
    storeSession(sessionExpiringIn(3600));
    await apiFetch("/api/player/x");
    assert.equal(sentAuthorization(), `Bearer ${TOKEN}`);
  });

  test("sends no token once the session is inside the clock-skew buffer", async () => {
    storeSession(sessionExpiringIn(CLOCK_SKEW_BUFFER_SEC - 1));
    await apiFetch("/api/player/x");
    assert.equal(sentAuthorization(), null);
    assert.equal(env.storage.getItem(SESSION_STORAGE_KEY), null);
  });

  test("never overwrites an Authorization header the caller set", async () => {
    storeSession(sessionExpiringIn(3600));
    const callerValue = `Bearer ${OTHER}`;
    const forms: Record<string, HeadersInit> = {
      "a plain object, lower-case name": { authorization: callerValue },
      "a Headers instance": new Headers({ Authorization: callerValue }),
      "an array of pairs": [["Authorization", callerValue]],
    };
    for (const [label, headers] of Object.entries(forms)) {
      await apiFetch("/api/player/x", { headers });
      assert.equal(sentAuthorization(), callerValue, label);
    }
  });

  test("keeps the caller's method, body and other headers", async () => {
    storeSession(sessionExpiringIn(3600));
    const body = JSON.stringify({ roll: true });
    await apiFetch("/api/game/x/roll", {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json" },
    });

    const { init } = lastCall();
    assert.equal(init?.method, "POST");
    assert.equal(init?.body, body);
    const sent = new Headers(init?.headers);
    assert.equal(sent.get("Content-Type"), "application/json");
    assert.equal(sent.get("Authorization"), `Bearer ${TOKEN}`);
  });

  test("does not write the token into the caller's init object", async () => {
    // A reused init that had picked up an Authorization header would keep
    // sending the old token after sign-out, because apiFetch never overwrites
    // a header that is already there.
    storeSession(sessionExpiringIn(3600));
    const headers = { "Content-Type": "application/json" };
    const init: RequestInit = { method: "POST", headers };
    await apiFetch("/api/game/x/roll", init);

    assert.deepEqual(init, { method: "POST", headers: { "Content-Type": "application/json" } });
    assert.equal(init.headers, headers);
  });

  test("does not write the token into a caller's Headers instance or header pairs", async () => {
    // The same hazard in the other two HeadersInit forms. A Headers instance is
    // the one an implementation could reuse and set the header on in place.
    storeSession(sessionExpiringIn(3600));

    const instance = new Headers({ "Content-Type": "application/json" });
    await apiFetch("/api/game/x/roll", { method: "POST", headers: instance });
    assert.equal(sentAuthorization(), `Bearer ${TOKEN}`);
    assert.equal(instance.has("Authorization"), false);
    assert.deepEqual([...instance], [["content-type", "application/json"]]);

    const pairs: [string, string][] = [["Content-Type", "application/json"]];
    await apiFetch("/api/game/x/roll", { method: "POST", headers: pairs });
    assert.equal(sentAuthorization(), `Bearer ${TOKEN}`);
    assert.deepEqual(pairs, [["Content-Type", "application/json"]]);
  });

  test("reads the token at call time, across sign-in and sign-out", async () => {
    await apiFetch("/api/player/x");
    assert.equal(sentAuthorization(), null);

    storeSession(sessionExpiringIn(3600));
    await apiFetch("/api/player/x");
    assert.equal(sentAuthorization(), `Bearer ${TOKEN}`);

    storeSession(sessionExpiringIn(3600, OTHER));
    await apiFetch("/api/player/x");
    assert.equal(sentAuthorization(), `Bearer ${OTHER}`);

    storeSession(null);
    await apiFetch("/api/player/x");
    assert.equal(sentAuthorization(), null);
  });

  test("resolves to fetch's own response", async () => {
    const response = new Response("ok", { status: 201 });
    fetchMock.mock.mockImplementation(async () => response);
    assert.equal(await apiFetch("/api/player/x"), response);
  });
});

describe("hasSession", () => {
  test("is true exactly when currentToken() is non-null", () => {
    const states: Array<[label: string, stored: string | null, expected: boolean]> = [
      ["nothing stored", null, false],
      ["live session", JSON.stringify(sessionExpiringIn(3600)), true],
      ["inside the skew buffer", JSON.stringify(sessionExpiringIn(CLOCK_SKEW_BUFFER_SEC - 1)), false],
      ["already expired", JSON.stringify(sessionExpiringIn(-3600)), false],
      ["malformed", "{", false],
    ];
    for (const [label, stored, expected] of states) {
      env.storage.clear();
      if (stored !== null) env.storage.setItem(SESSION_STORAGE_KEY, stored);
      assert.equal(hasSession(), expected, label);
      assert.equal(hasSession(), currentToken() !== null, label);
    }
  });
});
