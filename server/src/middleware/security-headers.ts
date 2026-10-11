/**
 * Security headers middleware.
 *
 * Sets a defensive baseline on every API response. These are defence-
 * in-depth: a compromise elsewhere still has to defeat these headers
 * before it can hijack a player's wallet session or inject scripts.
 *
 * Tuned for the meme-grid-game API specifically — the public frontend
 * is a Next.js app at memegrid.radixguild.com which sets its own headers
 * in next.config.ts (its CSP is report-only for now, reporting to
 * routes/csp-report.ts). This file only secures the JSON API at
 * port 3004. Most of these headers don't matter for a pure JSON endpoint
 * (can't inject scripts into JSON) but we set them anyway because
 * curl/script consumers sometimes proxy responses into HTML contexts.
 *
 * See OWASP Secure Headers Project for the full rationale:
 *   https://owasp.org/www-project-secure-headers/
 */

import type { Request, Response, NextFunction } from "express";

// CSP tuned for an API that never serves HTML. If the response does
// get rendered (unusual) it's inline-resource only — no remote.
const API_CSP =
  "default-src 'none'; " +
  "frame-ancestors 'none'; " +
  "base-uri 'none'; " +
  "form-action 'none'";

// One year HSTS with preload — standard recommendation. Only effective
// when served over https; harmless on http during local dev.
const HSTS = "max-age=31536000; includeSubDomains; preload";

// Only allow this origin to be embedded in exactly nothing (no iframes).
const FRAME_OPTIONS = "DENY";

// Referrer policy — don't leak full URLs cross-origin.
const REFERRER_POLICY = "strict-origin-when-cross-origin";

// Permissions-Policy — disable every feature we don't explicitly use.
// The API never needs camera, microphone, geolocation, etc.
const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=()",
  "camera=()",
  "clipboard-read=()",
  "clipboard-write=()",
  "display-capture=()",
  "fullscreen=()",
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "idle-detection=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "picture-in-picture=()",
  "publickey-credentials-get=()",
  "screen-wake-lock=()",
  "serial=()",
  "sync-xhr=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

export function securityHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader("Content-Security-Policy", API_CSP);
  res.setHeader("Strict-Transport-Security", HSTS);
  res.setHeader("X-Frame-Options", FRAME_OPTIONS);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", REFERRER_POLICY);
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  // Remove Express's default fingerprint. Small defence-in-depth win.
  res.removeHeader("X-Powered-By");
  next();
}
