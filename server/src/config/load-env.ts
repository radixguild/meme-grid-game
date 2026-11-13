/**
 * Shared env loader — side-effect module that populates process.env
 * from .env + secrets.env before any other module reads it.
 *
 * Extracted from config/env.ts so both `config/sentry.ts` (which must
 * run before any express import) and `config/env.ts` (validation) can
 * import it without a chicken-and-egg dependency. Safe to import
 * multiple times — dotenv.config() is idempotent with override: false
 * for the main .env, and override: true for secrets.env always wins.
 *
 * Test runs load neither file (see isTestRun). Every other start loads both.
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

export interface EnvFiles {
  env: readonly string[];
  secrets: readonly string[];
}

/** The fixed files a normal start loads. */
export const OPERATOR_ENV_FILES: EnvFiles = { env: ENV_CANDIDATES, secrets: SECRETS_CANDIDATES };

/**
 * True when this process is running tests under Node's test runner.
 *
 * Tests set their own env (fixed keys, tokens, addresses) before importing the
 * app. On a machine that also holds the operator's files, loading secrets.env
 * with override:true would replace those values with the real ones, so the
 * suite would test the operator's config instead of its own.
 *
 * Both signals come from Node itself, not from a variable this project defines,
 * so no setting in an operator's env can switch file loading off, and they hold
 * however the runner was started (`npm test`, `tsx --test <file>`, `node --test`):
 *   - NODE_TEST_CONTEXT is set in every process the runner starts for a test file;
 *   - `--test` is in execArgv when test files run inside the runner's own process.
 * A production start (`node dist/index.js`, `tsx watch src/index.ts`) has neither.
 * src/config/__tests__/load-env.test.ts fails if a Node upgrade drops them.
 */
export function isTestRun(
  env: NodeJS.ProcessEnv = process.env,
  execArgv: readonly string[] = process.execArgv,
): boolean {
  return Boolean(env.NODE_TEST_CONTEXT) || execArgv.includes("--test");
}

/** Load the given files into process.env: .env never overrides, secrets.env always does. */
export function loadEnvFiles(files: EnvFiles): void {
  for (const f of files.env) {
    if (fs.existsSync(f)) {
      dotenv.config({ path: f, override: false });
    }
  }

  for (const f of files.secrets) {
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
}

if (!isTestRun()) {
  loadEnvFiles(OPERATOR_ENV_FILES);
}
