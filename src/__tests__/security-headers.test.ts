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
 * The CSP is REPORT-ONLY (2026-10-08, see next.config.ts): the tests below
 * pin that it reports to the Express sink via report-uri alone, and that no
 * enforcing Content-Security-Policy header has crept in ahead of the sweep.
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

async function withNodeEnv<T>(value: string | undefined, fn: () => Promise<T>): Promise<T> {
  const env = process.env as Record<string, string | undefined>;
  const saved = env.NODE_ENV;
  if (value === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = value;
  try {
    return await fn();
  } finally {
    if (saved === undefined) delete env.NODE_ENV;
    else env.NODE_ENV = saved;
  }
}

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

  test("sends the CSP as Report-Only, never as an enforcing header", async () => {
    const byKey = await headersByKey();
    const keys = Object.keys(byKey).map((k) => k.toLowerCase());

    assert.ok(byKey["Content-Security-Policy-Report-Only"], "expected a Content-Security-Policy-Report-Only header");
    // Enforcing waits for the report-only sweep (next.config.ts). An enforcing
    // header here would block live loads the reports have not cleared yet.
    assert.ok(!keys.includes("content-security-policy"), "no enforcing Content-Security-Policy header yet");
  });

  test("reports to /api/csp-report via report-uri only — no report-to", async () => {
    const byKey = await headersByKey();
    const policy = directives(byKey["Content-Security-Policy-Report-Only"]!);
    const keys = Object.keys(byKey).map((k) => k.toLowerCase());

    assert.equal(policy.get("report-uri"), "/api/csp-report");
    // Chromium ignores report-uri when report-to is present (next.config.ts).
    assert.equal(policy.has("report-to"), false);
    assert.ok(!keys.includes("reporting-endpoints"));
    assert.ok(!keys.includes("report-to"));
  });

  test("pins the policy's directives", async () => {
    const byKey = await withNodeEnv("production", headersByKey);
    const policy = directives(byKey["Content-Security-Policy-Report-Only"]!);

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
      const scriptSrc = directives(byKey["Content-Security-Policy-Report-Only"]!).get("script-src")!;
      assert.ok(!scriptSrc.includes("'unsafe-eval'"), `NODE_ENV=${env}: ${scriptSrc}`);
    }
    const dev = await withNodeEnv("development", headersByKey);
    assert.equal(directives(dev["Content-Security-Policy-Report-Only"]!).get("script-src"), "'self' 'unsafe-inline' 'unsafe-eval'");
  });
});
