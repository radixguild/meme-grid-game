/**
 * A test run must never load the operator's .env / secrets.env, or the
 * operator's real key, address and admin token replace the values a test set.
 * A normal start must still load both, with secrets.env winning.
 *
 * Fake files are planted in a temp dir. Nothing here reads a real env file:
 * the one case that simulates a normal start of the real module is skipped
 * when operator files sit next to it (a deployed checkout).
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isTestRun, loadEnvFiles, OPERATOR_ENV_FILES } from "../load-env";

const LOAD_ENV = path.resolve(__dirname, "../load-env.ts");
const SERVER_DIR = path.resolve(__dirname, "../../..");
const OPERATOR_FILES_PRESENT =
  fs.existsSync(path.join(SERVER_DIR, ".env")) || fs.existsSync(path.join(SERVER_DIR, "secrets.env"));

// What a test sets, and what the planted files say instead.
const TEST_VALUES = {
  ADMIN_TOKEN: "test-admin-token",
  BOT_PRIVATE_KEY: "test-private-key",
  RADIX_MAINNET_ADDRESS: "test-signer-address",
  RADIX_NETWORK: "test-network",
};
const PLANTED = "planted-by-load-env-test";

let dir = "";

/** Run a fresh process in `dir` that imports load-env and reports what it sees. */
function childSees(env: NodeJS.ProcessEnv): Record<string, boolean> {
  const script = path.join(dir, "probe.ts");
  fs.writeFileSync(
    script,
    `import ${JSON.stringify(LOAD_ENV)};
const planted = ${JSON.stringify(PLANTED)};
const test = ${JSON.stringify(TEST_VALUES)};
console.log(JSON.stringify({
  secretsProbeLoaded: process.env.LOAD_ENV_SECRETS_PROBE === planted,
  envProbeLoaded: process.env.LOAD_ENV_ENV_PROBE === planted,
  adminTokenKept: process.env.ADMIN_TOKEN === test.ADMIN_TOKEN,
  privateKeyKept: process.env.BOT_PRIVATE_KEY === test.BOT_PRIVATE_KEY,
  signerAddressKept: process.env.RADIX_MAINNET_ADDRESS === test.RADIX_MAINNET_ADDRESS,
  networkKept: process.env.RADIX_NETWORK === test.RADIX_NETWORK,
}));
`,
  );
  // Same loader as this process (tsx), minus any runner flags.
  const execArgv = process.execArgv.filter((a) => !a.startsWith("--test"));
  const out = spawnSync(process.execPath, [...execArgv, script], { cwd: dir, env, encoding: "utf8" });
  assert.equal(out.status, 0, `probe exited ${out.status}: ${out.stderr}`);
  return JSON.parse(out.stdout.trim().split("\n").pop() ?? "{}");
}

describe("config/load-env", () => {
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "load-env-test-"));
    fs.writeFileSync(
      path.join(dir, ".env"),
      `RADIX_NETWORK=${PLANTED}\nLOAD_ENV_ENV_PROBE=${PLANTED}\n`,
    );
    fs.writeFileSync(
      path.join(dir, "secrets.env"),
      [
        `ADMIN_TOKEN=${PLANTED}`,
        `BOT_PRIVATE_KEY=${PLANTED}`,
        `RADIX_MAINNET_ADDRESS=${PLANTED}`,
        `LOAD_ENV_SECRETS_PROBE=${PLANTED}`,
        "",
      ].join("\n"),
      { mode: 0o600 },
    );
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("detects this process as a test run (fails if Node stops marking test processes)", () => {
    assert.equal(isTestRun(), true);
  });

  it("tells a test run from a normal start", () => {
    assert.equal(isTestRun({ NODE_TEST_CONTEXT: "child-v8" }, []), true);
    assert.equal(isTestRun({}, ["--enable-source-maps", "--test"]), true);
    assert.equal(isTestRun({}, []), false, "node dist/index.js");
    assert.equal(isTestRun({ NODE_ENV: "production" }, ["--enable-source-maps"]), false);
  });

  it("loads only this project's own files on a normal start", () => {
    assert.deepEqual(OPERATOR_ENV_FILES, {
      env: [path.join(process.cwd(), ".env"), path.join(SERVER_DIR, ".env")],
      secrets: [path.join(process.cwd(), "secrets.env"), path.join(SERVER_DIR, "secrets.env")],
    });
  });

  it("a test run ignores a planted secrets.env with conflicting values", () => {
    const sees = childSees({ ...process.env, ...TEST_VALUES, NODE_TEST_CONTEXT: "child-v8" });
    assert.deepEqual(sees, {
      secretsProbeLoaded: false,
      envProbeLoaded: false,
      adminTokenKept: true,
      privateKeyKept: true,
      signerAddressKept: true,
      networkKept: true,
    });
  });

  it(
    "a normal start loads the planted files, secrets.env overriding",
    { skip: OPERATOR_FILES_PRESENT && "operator env files present; a test does not load them" },
    () => {
      const env: NodeJS.ProcessEnv = { ...process.env, ...TEST_VALUES };
      delete env.NODE_TEST_CONTEXT;
      assert.deepEqual(childSees(env), {
        secretsProbeLoaded: true,
        envProbeLoaded: true,
        adminTokenKept: false,
        privateKeyKept: false,
        signerAddressKept: false,
        networkKept: true, // .env never overrides a value already set
      });
    },
  );

  it("loadEnvFiles: .env fills gaps only, secrets.env always overrides", () => {
    const keys = [...Object.keys(TEST_VALUES), "LOAD_ENV_ENV_PROBE", "LOAD_ENV_SECRETS_PROBE"];
    const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
    try {
      Object.assign(process.env, TEST_VALUES);
      delete process.env.LOAD_ENV_ENV_PROBE;
      delete process.env.LOAD_ENV_SECRETS_PROBE;
      loadEnvFiles({ env: [path.join(dir, ".env")], secrets: [path.join(dir, "secrets.env")] });
      assert.equal(process.env.LOAD_ENV_ENV_PROBE, PLANTED);
      assert.equal(process.env.RADIX_NETWORK, TEST_VALUES.RADIX_NETWORK);
      assert.equal(process.env.LOAD_ENV_SECRETS_PROBE, PLANTED);
      assert.equal(process.env.ADMIN_TOKEN, PLANTED);
      assert.equal(process.env.BOT_PRIVATE_KEY, PLANTED);
      assert.equal(process.env.RADIX_MAINNET_ADDRESS, PLANTED);
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });
});
