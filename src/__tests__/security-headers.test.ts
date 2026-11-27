/**
 * Proves next.config.ts actually declares the security-header baseline —
 * client-handover audit, "memegrid" theme (2026-09-30). Before this fix,
 * `next.config.ts` was `{}`: memegrid.radixguild.com shipped none of the
 * headers radixguild.com enforces and leaked `x-powered-by: Next.js`.
 *
 * This only proves the CONFIG says the right thing (what a curl against a
 * running build would see, per Next's headers() contract — it's static
 * config, not per-request logic, so there's nothing more dynamic to test
 * without booting a server).
 *
 * The CSP is ENFORCED (see next.config.ts): the tests below pin that it is
 * sent as `Content-Security-Policy`, that no report-only copy has crept back
 * in (a report-only header blocks nothing), and that it still reports to the
 * Express sink via report-uri alone.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import nextConfig from "../../next.config";

async function headersByKey(): Promise<Record<string, string>> {
  assert.equal(typeof nextConfig.headers, "function");
  const rules = await nextConfig.headers!();
  // Must cover every route — a hand-picked source list would leave
  // whatever's left off unprotected.
  const rule = rules.find((r) => r.source === "/:path*");
  assert.ok(rule, "expected a headers() rule for source \"/:path*\"");
  return Object.fromEntries(rule!.headers.map((h) => [h.key, h.value]));
}

function directives(policy: string): Map<string, string> {
  return new Map(
    policy
      .split(";")
      .map((d) => d.trim())
      .filter(Boolean)
      .map((d) => {
        const [name, ...values] = d.split(/\s+/);
        return [name!, values.join(" ")] as [string, string];
      })
  );
}

async function withEnv<T>(name: string, value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const env = process.env as Record<string, string | undefined>;
  const saved = env[name];
  if (value === undefined) delete env[name];
  else env[name] = value;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete env[name];
    else env[name] = saved;
  }
}

const withNodeEnv = <T>(value: string | undefined, fn: () => Promise<T>) => withEnv("NODE_ENV", value, fn);

describe("next.config.ts security headers", () => {
  test("disables the X-Powered-By fingerprint", () => {
    assert.equal(nextConfig.poweredByHeader, false);
  });

  test("headers() applies the full baseline to every route", async () => {
    const byKey = await headersByKey();

    assert.equal(byKey["Strict-Transport-Security"], "max-age=63072000; includeSubDomains");
    assert.equal(byKey["X-Content-Type-Options"], "nosniff");
    assert.equal(byKey["Referrer-Policy"], "strict-origin-when-cross-origin");
    assert.equal(byKey["X-Frame-Options"], "DENY");
    assert.equal(byKey["Permissions-Policy"], "camera=(), microphone=(), geolocation=()");
  });

  test("enforces the CSP, with no report-only copy", async () => {
    const byKey = await headersByKey();
    const keys = Object.keys(byKey).map((k) => k.toLowerCase());

    assert.ok(byKey["Content-Security-Policy"], "expected an enforcing Content-Security-Policy header");
    // A report-only header blocks nothing; it must not stand in for, or sit
    // beside, the enforcing one.
    assert.ok(!keys.includes("content-security-policy-report-only"), "no Content-Security-Policy-Report-Only header");
  });

  test("reports to /api/csp-report via report-uri only — no report-to", async () => {
    const byKey = await headersByKey();
    const policy = directives(byKey["Content-Security-Policy"]!);
    const keys = Object.keys(byKey).map((k) => k.toLowerCase());

    assert.equal(policy.get("report-uri"), "/api/csp-report");
    // Chromium ignores report-uri when report-to is present (next.config.ts).
    assert.equal(policy.has("report-to"), false);
    assert.ok(!keys.includes("reporting-endpoints"));
    assert.ok(!keys.includes("report-to"));
  });

  test("pins the policy's directives", async () => {
    const byKey = await withNodeEnv("production", headersByKey);
    const policy = directives(byKey["Content-Security-Policy"]!);

    assert.deepEqual(Object.fromEntries(policy), {
      "default-src": "'self'",
      "script-src": "'self' 'unsafe-inline'",
      "style-src": "'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src": "'self' data: https:",
      "font-src": "'self' data: https://fonts.gstatic.com",
      "connect-src": "'self' https://mainnet.radixdlt.com https://*.radixdlt.com wss://*.radixdlt.com",
      "object-src": "'none'",
      "frame-ancestors": "'none'",
      "base-uri": "'self'",
      "form-action": "'self'",
      "report-uri": "/api/csp-report",
    });
  });

  test("grants 'unsafe-eval' to `next dev` only", async () => {
    for (const env of ["production", "test", undefined]) {
      const byKey = await withNodeEnv(env, headersByKey);
      const scriptSrc = directives(byKey["Content-Security-Policy"]!).get("script-src")!;
      assert.ok(!scriptSrc.includes("'unsafe-eval'"), `NODE_ENV=${env}: ${scriptSrc}`);
    }
    const dev = await withNodeEnv("development", headersByKey);
    assert.equal(directives(dev["Content-Security-Policy"]!).get("script-src"), "'self' 'unsafe-inline' 'unsafe-eval'");
  });

  test("adds the API's origin to connect-src under `next dev` only", async () => {
    const PROD_CONNECT = "'self' https://mainnet.radixdlt.com https://*.radixdlt.com wss://*.radixdlt.com";
    const connectSrc = (byKey: Record<string, string>) => directives(byKey["Content-Security-Policy"]!).get("connect-src");

    // Default API_URL (http://localhost:3004/api): another port is another
    // origin, so an enforced 'self' alone would block local dev's API calls.
    await withEnv("NEXT_PUBLIC_API_URL", undefined, async () => {
      assert.equal(connectSrc(await withNodeEnv("development", headersByKey)), `${PROD_CONNECT} http://localhost:3004`);
      for (const env of ["production", "test", undefined]) {
        assert.equal(connectSrc(await withNodeEnv(env, headersByKey)), PROD_CONNECT, `NODE_ENV=${env}`);
      }
    });
    // An explicit API URL: its origin only (no path).
    await withEnv("NEXT_PUBLIC_API_URL", "http://127.0.0.1:4000/api", async () => {
      assert.equal(connectSrc(await withNodeEnv("development", headersByKey)), `${PROD_CONNECT} http://127.0.0.1:4000`);
      assert.equal(connectSrc(await withNodeEnv("production", headersByKey)), PROD_CONNECT);
    });
    // A relative API URL is same-origin: nothing added.
    await withEnv("NEXT_PUBLIC_API_URL", "/api", async () => {
      assert.equal(connectSrc(await withNodeEnv("development", headersByKey)), PROD_CONNECT);
    });
  });
});
