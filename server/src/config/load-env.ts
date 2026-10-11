/**
 * Shared env loader — side-effect module that populates process.env
 * from .env + secrets.env before any other module reads it.
 *
 * Extracted from config/env.ts so both `config/sentry.ts` (which must
 * run before any express import) and `config/env.ts` (validation) can
 * import it without a chicken-and-egg dependency. Safe to import
 * multiple times — dotenv.config() is idempotent with override: false
 * for the main .env, and override: true for secrets.env always wins.
 */

import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// 1. Regular .env (non-secret config: ports, addresses, feature flags)
const ENV_CANDIDATES = [
  path.join(process.cwd(), ".env"),
  path.join(__dirname, "../../.env"),
];

// 2. secrets.env (BOT_PRIVATE_KEY, SENTRY_DSN, ADMIN_TOKEN, anything that
//    grants action if leaked). Loaded AFTER .env so it can override
//    placeholder values. Perm-checked.
//
// This project's own files ONLY. Never add a shared or another project's path
// here: these are loaded with override:true, so a foreign secrets file silently
// REPLACES this server's signing key — the game would sign as whatever project
// owns that file, with that project's badges. MEME GRID is a standalone app and
// must never be able to read /opt/<deploy-root>/** (another project's deploy
// root), ~/.secrets/**, or any guild path.
const SECRETS_CANDIDATES = [
  path.join(process.cwd(), "secrets.env"),
  path.join(__dirname, "../../secrets.env"),
];

for (const f of ENV_CANDIDATES) {
  if (fs.existsSync(f)) {
    dotenv.config({ path: f, override: false });
  }
}

for (const f of SECRETS_CANDIDATES) {
  if (!fs.existsSync(f)) continue;
  // Warn on loose perms — secrets files should be 0600 (owner rw only).
  try {
    const mode = fs.statSync(f).mode & 0o777;
    if (mode !== 0o600 && mode !== 0o400) {
      console.warn(
        `[config] ⚠ ${f} has mode 0${mode.toString(8)} — recommended 0600. Fix: chmod 600 ${f}`
      );
    }
  } catch {
    /* best-effort perm check */
  }
  dotenv.config({ path: f, override: true });
}
