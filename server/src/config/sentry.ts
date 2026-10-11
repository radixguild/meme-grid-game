/**
 * Sentry integration — error + performance tracking.
 *
 * CRITICAL ORDERING
 * -----------------
 * This module is imported at the VERY TOP of index.ts as a side effect
 * (before any other import). That guarantees:
 *
 *   1. `./load-env` runs first → process.env populated from .env + secrets.env
 *   2. `Sentry.init()` runs at module-load time with DSN from env
 *   3. Only THEN does Express (and everything else) get imported
 *
 * Without this order, Sentry's OpenTelemetry auto-instrumentation can't
 * wrap Express/http — you get
 *   [Sentry] express is not instrumented...
 * and lose automatic request-level tracing.
 */

// MUST be the first import in this file.
import "./load-env";

import * as Sentry from "@sentry/node";

// Redact known-sensitive keys from any captured data before send.
// Defense in depth against accidentally including a secret in an error.
const SENSITIVE_KEY_PATTERNS = [
  /private[_-]?key/i,
  /bot[_-]?key/i,
  /admin[_-]?token/i,
  /authorization/i,
  /cookie/i,
  /secret/i,
  /password/i,
  /api[_-]?key/i,
];

function redactObjectInPlace(obj: unknown, depth = 0): void {
  if (depth > 8 || obj === null || typeof obj !== "object") return;
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERNS.some((re) => re.test(key))) {
      (obj as Record<string, unknown>)[key] = "[REDACTED]";
      continue;
    }
    redactObjectInPlace((obj as Record<string, unknown>)[key], depth + 1);
  }
}

// Initialise at module-load time — no function wrapper, no deferred call.
// This is what gives OpenTelemetry a chance to wrap express() before
// anything imports it.
const dsn = process.env.SENTRY_DSN;
let initialised = false;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    release: process.env.SENTRY_RELEASE || process.env.npm_package_version,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1"),
    sendDefaultPii: false,
    beforeSend(event) {
      try {
        if (event.request) {
          redactObjectInPlace(event.request.headers);
          redactObjectInPlace(event.request.cookies);
          redactObjectInPlace(event.request.data);
        }
        if (event.extra) redactObjectInPlace(event.extra);
        if (event.contexts) redactObjectInPlace(event.contexts);
        if (event.contexts && "runtime" in event.contexts) {
          const r = event.contexts.runtime as Record<string, unknown>;
          delete r.env;
        }
      } catch {
        /* never let the scrubber crash the event */
      }
      return event;
    },
    beforeBreadcrumb(crumb) {
      if (crumb.data) redactObjectInPlace(crumb.data);
      return crumb;
    },
  });
  initialised = true;
  console.log(
    `[sentry] initialised — env=${Sentry.getClient()?.getOptions().environment ?? "?"}`
  );
} else {
  console.log("[sentry] disabled (SENTRY_DSN not set)");
}

// Optional boot-time diagnostic ping — fires once on startup if env flag
// is set. Useful after first deploy to confirm events land in the UI.
// Remove the env var once you've verified a real event comes through.
if (initialised && process.env.SENTRY_TEST_ON_BOOT === "1") {
  Sentry.captureMessage(
    `[boot] ${process.env.APPLICATION_NAME ?? "meme-grid-server"} started ` +
    `(env=${Sentry.getClient()?.getOptions().environment})`,
    "info"
  );
  console.log("[sentry] test boot message sent");
}

/** Capture an error with optional structured context. Safe if not initialised. */
export function captureError(err: unknown, context?: Record<string, unknown>): void {
  if (!initialised) return;
  if (context) {
    Sentry.withScope((scope) => {
      for (const [k, v] of Object.entries(context)) scope.setExtra(k, v);
      Sentry.captureException(err);
    });
  } else {
    Sentry.captureException(err);
  }
}

/** For back-compat with earlier API. No-op at module level — init already ran. */
export function initSentry(): void {
  /* already initialised at module load; kept for backward-compat imports */
}

export { Sentry };
