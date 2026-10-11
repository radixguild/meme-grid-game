/**
 * src/lib/session.ts — where the client keeps its ROLA session, and the one
 * definition of when that session counts as expired. useAuth and apiFetch both
 * read through it, so a wrong answer here either sends a token the server has
 * already expired (a route that requires a session answers 401) or throws away
 * a live one.
 *
 * Runs under `tsx --test`, outside Next's bundler: relative imports only, and
 * the browser globals come from ./browser-globals. Date.now is pinned with
 * mock.method, so the expiry boundary is tested to the second (and to the last
 * millisecond inside it) instead of racing a real clock tick.
 */

import { after, afterEach, before, beforeEach, describe, mock, test } from "node:test";
import assert from "node:assert/strict";
import {
  CLOCK_SKEW_BUFFER_SEC,
  SESSION_STORAGE_KEY,
  currentToken,
  loadStoredSession,
  storeSession,
  type Session,
} from "../session";
import { installBrowserGlobals, type BrowserGlobals } from "./browser-globals";
// A checksum-valid account address from the shared fixture (never invent one; see
// that file's header). session.ts treats the address as an opaque string, but the
// fixture keeps it honest.
import { MAINNET_ACCOUNTS } from "../../../server/src/__tests__/fixtures/addresses";

const NOW_SEC = 1_790_000_000;
// 64 hex chars, the shape the server issues. Low-entropy on purpose: a random-
// looking literal in a variable named TOKEN trips gitleaks' generic-api-key rule.
const TOKEN = "ab".repeat(32);

function sessionExpiringIn(seconds: number): Session {
  return { token: TOKEN, address: MAINNET_ACCOUNTS[0], expiresAt: NOW_SEC + seconds };
}

let env: BrowserGlobals;
let clock: ReturnType<typeof mock.method<DateConstructor, "now">>;

before(() => {
  env = installBrowserGlobals();
});

after(() => {
  env.uninstall();
});

beforeEach(() => {
  env.storage.clear();
  clock = mock.method(Date, "now", () => NOW_SEC * 1000);
});

afterEach(() => {
  mock.restoreAll();
});

describe("loadStoredSession", () => {
  test("returns null and leaves storage alone when there is no window (server render)", () => {
    const stored = JSON.stringify(sessionExpiringIn(3600));
    env.storage.setItem(SESSION_STORAGE_KEY, stored);

    env.withoutWindow(() => {
      assert.equal(loadStoredSession(), null);
      assert.equal(currentToken(), null);
      storeSession(null);
      storeSession(sessionExpiringIn(7200));
    });

    assert.equal(env.storage.getItem(SESSION_STORAGE_KEY), stored);
  });

  test("returns null when nothing is stored", () => {
    assert.equal(loadStoredSession(), null);
  });

  test("returns null for a stored value that is not JSON", () => {
    for (const raw of ["not json", "{", "{\"token\":"]) {
      env.storage.setItem(SESSION_STORAGE_KEY, raw);
      assert.equal(loadStoredSession(), null, `raw = ${raw}`);
    }
  });

  test("returns null when a field is missing or has the wrong type", () => {
    const live = sessionExpiringIn(3600);
    const cases: Record<string, unknown> = {
      "JSON null": null,
      "an array": [],
      "a number": 42,
      "a string": "token",
      "no token": { address: live.address, expiresAt: live.expiresAt },
      "no address": { token: live.token, expiresAt: live.expiresAt },
      "no expiresAt": { token: live.token, address: live.address },
      "token not a string": { ...live, token: 1234 },
      "expiresAt as a string": { ...live, expiresAt: String(live.expiresAt) },
    };
    for (const [label, value] of Object.entries(cases)) {
      env.storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(value));
      assert.equal(loadStoredSession(), null, label);
    }
  });

  test("returns a live session as stored", () => {
    const live = sessionExpiringIn(3600);
    env.storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(live));
    assert.deepEqual(loadStoredSession(), live);
    assert.notEqual(env.storage.getItem(SESSION_STORAGE_KEY), null);
  });

  test("rejects and clears a session that has already expired", () => {
    env.storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionExpiringIn(-1)));
    assert.equal(loadStoredSession(), null);
    assert.equal(env.storage.getItem(SESSION_STORAGE_KEY), null);
  });

  test("rejects and clears a session inside the clock-skew buffer", () => {
    // NOW + 1 is still valid by this clock; it must count as expired anyway, or
    // a server whose clock runs ahead has already expired it and a route that
    // requires a session answers 401. This case fails if the buffer is ever
    // dropped to zero.
    for (const secondsLeft of [1, CLOCK_SKEW_BUFFER_SEC - 1]) {
      env.storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionExpiringIn(secondsLeft)));
      assert.equal(loadStoredSession(), null, `${secondsLeft}s left`);
      assert.equal(env.storage.getItem(SESSION_STORAGE_KEY), null, `${secondsLeft}s left`);
    }
  });

  test("the clock-skew buffer is 60 seconds", () => {
    // Every boundary here reads the constant, so only this pins its value: a smaller
    // buffer tolerates less client/server clock skew before a route answers 401.
    assert.equal(CLOCK_SKEW_BUFFER_SEC, 60);
  });

  test("accepts a session exactly CLOCK_SKEW_BUFFER_SEC from expiry", () => {
    const edge = sessionExpiringIn(CLOCK_SKEW_BUFFER_SEC);
    env.storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(edge));
    assert.deepEqual(loadStoredSession(), edge);
  });

  test("compares against whole seconds: the edge holds until the next second", () => {
    // session.ts floors Date.now() to unix seconds. 999 ms into the edge second
    // the session is still live; compared against fractional seconds it would
    // already count as expired. One full second later it is expired.
    const edge = sessionExpiringIn(CLOCK_SKEW_BUFFER_SEC);

    clock.mock.mockImplementation(() => NOW_SEC * 1000 + 999);
    env.storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(edge));
    assert.deepEqual(loadStoredSession(), edge);

    clock.mock.mockImplementation(() => NOW_SEC * 1000 + 1000);
    assert.equal(loadStoredSession(), null);
    assert.equal(env.storage.getItem(SESSION_STORAGE_KEY), null);
  });
});

describe("storeSession", () => {
  test("writes under the meme-grid-session key and round-trips", () => {
    // Renaming the key would silently sign every returning player out.
    assert.equal(SESSION_STORAGE_KEY, "meme-grid-session");

    const live = sessionExpiringIn(3600);
    storeSession(live);
    assert.deepEqual(JSON.parse(env.storage.getItem("meme-grid-session") ?? "null"), live);
    assert.deepEqual(loadStoredSession(), live);
  });

  test("storeSession(null) removes the stored session", () => {
    storeSession(sessionExpiringIn(3600));
    storeSession(null);
    assert.equal(env.storage.getItem(SESSION_STORAGE_KEY), null);
    assert.equal(loadStoredSession(), null);
  });
});

describe("currentToken", () => {
  test("is the token of a live session, and null otherwise", () => {
    assert.equal(currentToken(), null);

    storeSession(sessionExpiringIn(3600));
    assert.equal(currentToken(), TOKEN);

    storeSession(sessionExpiringIn(CLOCK_SKEW_BUFFER_SEC - 1));
    assert.equal(currentToken(), null);
  });
});
