import express from "express";
import cors from "cors";
import { Sentry } from "./config/sentry";
import { rateLimit } from "./middleware/rate-limit";
import { securityHeaders } from "./middleware/security-headers";
import { errorHandler } from "./middleware/error-handler";
import gameRoutes from "./routes/game";
import tokenRoutes from "./routes/token";
import leaderboardRoutes from "./routes/leaderboard";
import nftRoutes from "./routes/nfts";
import healthRoutes from "./routes/health";
import powerupRoutes from "./routes/powerups";
import dailyRoutes from "./routes/daily";
import adminRoutes from "./routes/admin";
import vaultRoutes from "./routes/vault";
import faucetRoutes from "./routes/faucet";
import authRoutes from "./routes/auth";
import guestRoutes from "./routes/guest";
import cspReportRoutes from "./routes/csp-report";

export function createApp() {
  const app = express();

  const origins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean)
    : ["http://localhost:3005"];

  // Disable Express's X-Powered-By header globally (also removed per-response
  // in securityHeaders, but this catches error responses and redirects).
  app.disable("x-powered-by");

  // Trust exactly ONE reverse-proxy hop — production runs behind Caddy, which
  // terminates TLS and appends the real client IP to X-Forwarded-For.
  //
  // Without this, `req.ip` is the socket peer (::1 for every request from Caddy),
  // so the per-IP rate limiter in middleware/rate-limit.ts collapses the whole
  // player base into a single 60 POST/min bucket.
  //
  // The value MUST stay `1`, not `true`. `true` makes Express trust the entire
  // X-Forwarded-For chain and take the left-most entry, which is client-supplied
  // — any player could forge a header and mint themselves an unlimited number of
  // rate-limit buckets (and poison the admin-auth log). `1` takes the value the
  // nearest trusted proxy (Caddy) wrote, which a client cannot control.
  app.set("trust proxy", 1);

  app.use(cors({ origin: origins }));
  app.use(express.json({ limit: "1kb" }));
  app.use(securityHeaders);
  app.use(rateLimit);

  app.use("/api", healthRoutes);
  app.use("/api", gameRoutes);
  app.use("/api", tokenRoutes);
  app.use("/api", leaderboardRoutes);
  app.use("/api", nftRoutes);
  app.use("/api", powerupRoutes);
  app.use("/api", dailyRoutes);
  app.use("/api", adminRoutes);
  app.use("/api", vaultRoutes);
  app.use("/api", faucetRoutes);
  app.use("/api", guestRoutes);
  // CSP violation reports from next.config.ts's report-only policy. Mounted
  // after rateLimit on purpose: the per-IP POST limit bounds the sink too.
  app.use("/api", cspReportRoutes);
  app.use("/api/auth", authRoutes);

  // Sentry Express error-handler. Installs itself after the routes so it
  // sees every thrown/next'd error. No-op if Sentry wasn't initialised
  // (missing DSN) so dev runs aren't affected.
  Sentry.setupExpressErrorHandler(app);

  app.use(errorHandler);

  return app;
}
