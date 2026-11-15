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
 * Test runs load neither file (see testRunMarker). Every other start, and every
 * start with NODE_ENV=production, loads both.
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
 * The marker that shows this process is running tests under Node's test runner,
 * or null on a normal start.
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
 *
 * NODE_ENV=production overrides both: the files always load. pm2 sets it for the
 * server (ecosystem.config.cjs) and no test sets it, so a production process
 * that inherited a runner's marker (pm2 copies the starting shell's env, and
 * `pm2 save` replays it after a reboot) still loads its env files. Skipping them
 * there would boot without the signing key and the required settings. The cost
 * is on the other side: a test run with NODE_ENV=production in its shell loads
 * the operator's files, so run tests with NODE_ENV unset.
 */
export function testRunMarker(
  env: NodeJS.ProcessEnv = process.env,
  execArgv: readonly string[] = process.execArgv,
): "NODE_TEST_CONTEXT" | "--test" | null {
  if (env.NODE_ENV === "production") return null;
  if (env.NODE_TEST_CONTEXT) return "NODE_TEST_CONTEXT";
  if (execArgv.includes("--test")) return "--test";
  return null;
}

/** True when this process is running tests under Node's test runner (see testRunMarker). */
export function isTestRun(
  env: NodeJS.ProcessEnv = process.env,
  execArgv: readonly string[] = process.execArgv,
): boolean {
  return testRunMarker(env, execArgv) !== null;
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
  // A production start that carries a runner's marker loads the files anyway
  // (see testRunMarker); say so, since a marker there means something upstream
  // leaked it into the app's environment.
  if (process.env.NODE_ENV === "production" && (process.env.NODE_TEST_CONTEXT || process.execArgv.includes("--test"))) {
    console.warn("[config] ⚠ a test-runner marker is set, but NODE_ENV=production: loading .env and secrets.env anyway");
  }
  loadEnvFiles(OPERATOR_ENV_FILES);
}
