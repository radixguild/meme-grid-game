import type { NextConfig } from "next";

// Security headers — client-handover audit, "memegrid" theme (2026-09-30).
//
// memegrid.radixguild.com shipped none of the headers radixguild.com enforces
// and leaked `x-powered-by: Next.js` (curl -sS -D - diff against radixguild.com
// in the audit evidence). Values below mirror the Radix Guild app's baseline
// (https://github.com/radixguild/guild) for consistency across the two sites —
// see guild-app/src/proxy.ts there (same header set, applied to its own
// /api/:path* via Next middleware); the Caddy-layer snippet with the same
// values for its page routes lives in the Guild's private operations
// repository.
//
// ── Content-Security-Policy: ENFORCED ────────────────────────────────────────
// Sent as `Content-Security-Policy`, so the browser refuses any load the
// policy does not allow. It was report-only from 2026-10-08
// (`Content-Security-Policy-Report-Only`, which blocks nothing). It is enforced
// on the strength of the local sweeps below; the live site's reports were not
// reviewed for that change. The
// browser still POSTs each refused load to /api/csp-report, which
// server/src/routes/csp-report.ts answers with one log line and stores
// nothing, so a blocked load shows up in the API log. The Guild app took the
// same path (report-only 2026-09-14, enforced 2026-09-30 after a headless
// sweep of every route plus the Radix Connect Button recorded 0 violations —
// the CSP comment block in guild-app/next.config.ts there).
// To fall back to report-only, rename the key back; nothing else changes.
//
// Local sweep, 2026-10-08 (headless Chromium 147, production build behind a
// proxy that routes like deploy/Caddyfile): all 11 app routes (/gift answers
// its by-design 404) plus an unknown path, with the Connect Button's popover
// opened on each, and "Connect Now" pressed on a desktop and a mobile
// viewport, recorded 0 violations and sent 0 reports. Off-origin requests
// seen: the Gateway (mainnet.radixdlt.com) and, on mobile, the Radix Connect
// relay. A positive control on the same build (an off-policy <script src> and
// fetch) WAS reported and reached the Express sink, so the sweep sees what it
// should.
//
// The directives start from the Guild app's enforced set and differ where this
// app differs:
// - script-src 'unsafe-inline': Next's inline bootstrap scripts (no nonce).
//   'unsafe-eval' in `next dev` ONLY, unlike the Guild's every-build grant:
//   Next's own CSP guide (node_modules/next/dist/docs/01-app/02-guides/
//   content-security-policy.md, "Without Nonces") gives exactly this shape,
//   since React evals only in development. The production build's client
//   chunks contain no eval( and no new Function( (grepped .next/static); the
//   one Function( is core-js's `Function("return this")()` global-object
//   fallback, which a browser never reaches (its globalThis check wins first).
// - object-src 'none': nothing here renders <object>/<embed>; also from that
//   guide's template.
// - style-src 'unsafe-inline' https://fonts.googleapis.com: React style={{}}
//   attributes (GameCell's background image), and the Radix Connect Button,
//   which appends a Google Fonts <link> to document.head when it renders
//   (`injectFontCSS` in the toolkit 2.3.0's dist/chunk-EDAH65BG.js) unless
//   document.fonts.check() says IBM Plex Sans is already there. Headless
//   Chromium skipped it in the sweep above; other engines may not.
//   font-src https://fonts.gstatic.com serves that stylesheet's font files.
// - img-src https:: /tokenomics shows each pooled NFT collection's on-ledger
//   icon_url, which can be any https host.
// - connect-src: 'self' covers the API (deploy/setup.sh builds with
//   NEXT_PUBLIC_API_URL on this site's own /api). mainnet.radixdlt.com is the
//   Gateway (src/lib/constants.ts) and *.radixdlt.com takes in the Radix
//   Connect relay (radix-connect-relay.radixdlt.com in the toolkit bundle).
//   The Guild's https://radixguild.com entry is dropped: nothing here fetches
//   it (the footer only links to it). wss://*.radixdlt.com is kept from the
//   Guild's set although the 2.3.0 bundle opens no WebSocket; dropping it is
//   left to a separate change so enforcing changed nothing but the key.
//   The production API must therefore stay on this site's own origin; a build
//   with NEXT_PUBLIC_API_URL on another origin needs that origin added here.
//   Under `next dev` ONLY, the API's origin is added too: the default
//   API_URL (http://localhost:3004/api, src/lib/constants.ts) is another port,
//   so another origin, and 'self' alone would block every API call in local
//   dev.
// - frame-ancestors 'none': the CSP form of X-Frame-Options: DENY below.
//
// report-uri ONLY: no `report-to`, no `Reporting-Endpoints`. The Guild app
// measured that Chromium ignores report-uri whenever report-to is present and
// then delivered nothing over the Reporting API either, so every Chrome user
// went silent (numbers in its next.config.ts). The sink still accepts the
// Reporting-API body shape, so adding report-to later needs no route change.
// In local dev, reports go to :3005/api/csp-report, which 404s.
//
// X-Frame-Options: DENY, not a narrower allow-list — grepped src/, server/src
// and docs/ for iframe/embed/widget: no hits, no documented or planned
// embedding surface. Kept alongside frame-ancestors 'none' for browsers that
// read only the older header.
const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=()";

// Caddy sends /api/* to the Express server (deploy/Caddyfile), so this
// same-origin path reaches server/src/routes/csp-report.ts.
const CSP_REPORT_URI = "/api/csp-report";

// The API origin `next dev` talks to: NEXT_PUBLIC_API_URL's origin, or the
// default in src/lib/constants.ts. Development builds only (see above).
function devApiOrigin(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3004/api";
  try {
    return new URL(apiUrl).origin;
  } catch {
    // A relative API_URL (e.g. "/api") is same-origin: 'self' covers it.
    return "";
  }
}

// Read at call time, not import time, so the test can check both builds.
function cspDirectives(): string {
  const isDev = process.env.NODE_ENV === "development";
  const devConnect = isDev && devApiOrigin() ? ` ${devApiOrigin()}` : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    `connect-src 'self' https://mainnet.radixdlt.com https://*.radixdlt.com wss://*.radixdlt.com${devConnect}`,
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `report-uri ${CSP_REPORT_URI}`,
  ].join("; ");
}

const nextConfig: NextConfig = {
  // Also see server/src/middleware/security-headers.ts — the Express API
  // (proxied at /api/* by deploy/Caddyfile) already disables its own
  // X-Powered-By and sets the full header set below plus an API-appropriate
  // CSP (`default-src 'none'`), since PR "Tier B defense-in-depth" (b7518d2,
  // 2026-04-18). No change needed there; this file covers only the Next.js
  // app half that PR didn't touch.
  poweredByHeader: false,

  async headers() {
    return [
      {
        // Every route — a page left out of a hand-picked list would be the
        // one page left unprotected.
        source: "/:path*",
        headers: [
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: PERMISSIONS_POLICY },
          // Enforced: see the comment block at the top of this file.
          { key: "Content-Security-Policy", value: cspDirectives() },
        ],
      },
    ];
  },
};

export default nextConfig;
