// ── Ordering-critical imports ───────────────────────────────────────
// `./config/sentry` must be imported FIRST as a side effect. It loads
// env (via ./config/load-env) and calls Sentry.init() at module-load
// time, which lets OpenTelemetry wrap Express before app.ts imports it.
// Deviating from this order breaks Sentry's auto-perf-instrumentation.
import "./config/sentry";

// Env check runs next — env is already populated by the line above.
import { applyEnvCheck } from "./config/env";
const envCheck = applyEnvCheck();

// ── Regular imports (express + downstream modules) ─────────────────
import { createApp } from "./app";
import { getDb } from "./db/connection";
import { runMigrations } from "./db/migrations/runner";
import { processOneMint, getMintQueueStats } from "./services/nft-minter";
import { assertSignerCustody, recoverOrphanedTransactions } from "./services/signer";
import { startAuthPurge } from "./auth/purge";

const PORT = parseInt(process.env.PORT || "3004", 10);
// Loopback by default: Caddy is the only client in production, and the 2026-09-09
// audit found this socket on *:3004 with UFW as the sole guard. Override with HOST
// only when something other than the local reverse proxy must reach it.
const HOST = process.env.HOST ?? "127.0.0.1";

// Initialize database and run migrations
const db = getDb();
runMigrations(db);
console.log("[db] initialized");

// Expired ROLA challenges and sessions are purged at boot and every 10 minutes.
// Without it the unauthenticated challenge endpoint grows the table forever.
startAuthPurge();

const app = createApp();

async function start() {
  // Prove the signing key controls the configured account before we accept any
  // traffic. Exits on mismatch — see assertSignerCustody for why that is fatal
  // rather than a degraded mode.
  await assertSignerCustody();

  // Recover any transactions orphaned by previous shutdown
  recoverOrphanedTransactions().catch(err =>
    console.error("[startup] orphaned TX recovery failed:", err.message)
  );

  app.listen(PORT, HOST, () => {
    console.log(`[meme-grid-server] listening on ${HOST}:${PORT}`);

    // Start NFT mint worker — processes queue every 30s. Skip if the
    // env check flagged signing or NFT-minter env as incomplete.
    const mintDisabled = envCheck.disabledFeatures.some(
      (f) => f.includes("signing") || f.includes("NFT mint worker")
    );
    if (!mintDisabled) {
      console.log("[nft-mint-worker] started (30s interval)");
      setInterval(async () => {
        try {
          const processed = await processOneMint();
          if (processed) {
            const stats = getMintQueueStats();
            console.log(`[nft-mint-worker] queue: ${stats.pending} pending, ${stats.minted} minted`);
          }
        } catch (err: any) {
          console.error("[nft-mint-worker] error:", err.message);
        }
      }, 30_000);
    } else {
      console.log("[nft-mint-worker] skipped (signing or NFT env incomplete)");
    }
  });
}

start().catch((err) => {
  console.error("[startup] failed:", err?.message ?? err);
  process.exit(1);
});
