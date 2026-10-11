process.env.DB_PATH = ":memory:";

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { getDb, closeDb } from "../../db/connection";
import { requireAuth } from "../require-auth";
import { issueSession } from "../../auth/session";
import { MAINNET_ACCOUNTS } from "../../__tests__/fixtures/addresses";

function setupSchema() {
  const db = getDb();
  db.exec("DROP TABLE IF EXISTS auth_sessions");
  db.exec(`
    CREATE TABLE auth_sessions (
      token TEXT PRIMARY KEY,
      radix_address TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      user_agent TEXT,
      origin TEXT,
      revoked_at INTEGER
    );
  `);
}

const ADDR = MAINNET_ACCOUNTS[0];
const OTHER = "account_rdx1other000000000000000000000000000000000000000000000000000";

function mkReq(headers: Record<string, string> = {}, params: Record<string, any> = {}): any {
  return { headers, params, ip: "127.0.0.1" };
}
function mkRes(): any {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => {
    r.statusCode = c;
    return r;
  };
  r.json = (b: any) => {
    r.body = b;
    return r;
  };
  return r;
}
async function runMw(mw: any, req: any, res: any): Promise<boolean> {
  let called = false;
  await mw(req, res, () => {
    called = true;
  });
  return called;
}

describe("require-auth", () => {
  beforeEach(() => {
    setupSchema();
    process.env.ROLA_AUTH_MODE = "legacy";
  });
  after(() => {
    closeDb();
    delete process.env.ROLA_AUTH_MODE;
  });

  it("legacy mode, no token, no :address → pass (no verifiedAddress)", async () => {
    const req = mkReq();
    const res = mkRes();
    assert.equal(await runMw(requireAuth(), req, res), true);
    assert.equal(req.verifiedAddress, undefined);
  });

  it("legacy mode, no token, has :address → pass, UNVERIFIED fallback", async () => {
    const req = mkReq({}, { address: ADDR });
    const res = mkRes();
    assert.equal(await runMw(requireAuth(), req, res), true);
    assert.equal(req.verifiedAddress, ADDR);
  });

  it("valid bearer wins over URL param (verifiedAddress = session)", async () => {
    const s = issueSession({ radix_address: ADDR });
    const req = mkReq({ authorization: `Bearer ${s.token}` }, { address: ADDR });
    const res = mkRes();
    assert.equal(await runMw(requireAuth(), req, res), true);
    assert.equal(req.verifiedAddress, ADDR);
  });

  it("valid bearer but URL address mismatch → 403", async () => {
    const s = issueSession({ radix_address: ADDR });
    const req = mkReq({ authorization: `Bearer ${s.token}` }, { address: OTHER });
    const res = mkRes();
    assert.equal(await runMw(requireAuth(), req, res), false);
    assert.equal(res.statusCode, 403);
  });

  it("required mode, missing token → 401", async () => {
    process.env.ROLA_AUTH_MODE = "required";
    const req = mkReq({}, { address: ADDR });
    const res = mkRes();
    assert.equal(await runMw(requireAuth(), req, res), false);
    assert.equal(res.statusCode, 401);
  });

  it("required mode, invalid token → 401", async () => {
    process.env.ROLA_AUTH_MODE = "required";
    const req = mkReq({ authorization: "Bearer " + "0".repeat(64) }, {});
    const res = mkRes();
    assert.equal(await runMw(requireAuth(), req, res), false);
    assert.equal(res.statusCode, 401);
  });

  it("malformed Authorization scheme is ignored gracefully in legacy mode", async () => {
    const req = mkReq(
      { authorization: "Basic " + Buffer.from("u:p").toString("base64") },
      {}
    );
    const res = mkRes();
    assert.equal(await runMw(requireAuth(), req, res), true);
  });

  it("optional mode: valid bearer attaches address, no bearer still passes", async () => {
    process.env.ROLA_AUTH_MODE = "optional";
    const s = issueSession({ radix_address: ADDR });
    const r1 = mkReq({ authorization: `Bearer ${s.token}` }, {});
    assert.equal(await runMw(requireAuth(), r1, mkRes()), true);
    assert.equal(r1.verifiedAddress, ADDR);
    const r2 = mkReq({}, {});
    assert.equal(await runMw(requireAuth(), r2, mkRes()), true);
    assert.equal(r2.verifiedAddress, undefined);
  });
});

// A guest-shaped id — `isOnChainAddress` returns false for it, which is all
// require-auth needs to know. Whether the tag actually verifies is
// validate.ts's job (auth/guest-id.test.ts), not tested again here.
const GUEST_ID = "guest_notonchain12345";

describe("require-auth — required-for-wallets (item 3/14 per-route gate)", () => {
  beforeEach(() => {
    setupSchema();
    // Env default stays "legacy" for every test in this block — the mode
    // under test is always the per-call opts.mode override, never the env,
    // unless a test says otherwise (the precedence tests at the bottom).
    process.env.ROLA_AUTH_MODE = "legacy";
  });
  after(() => {
    closeDb();
    delete process.env.ROLA_AUTH_MODE;
  });

  it("legacy read is unaffected by the new mode existing — still passes", async () => {
    const req = mkReq({}, { address: ADDR });
    const res = mkRes();
    assert.equal(await runMw(requireAuth(), req, res), true);
    assert.equal(req.verifiedAddress, ADDR);
  });

  it("funded route: bare account_ address, no session → 401", async () => {
    const req = mkReq({}, { address: ADDR });
    const res = mkRes();
    const mw = requireAuth({ mode: "required-for-wallets" });
    assert.equal(await runMw(mw, req, res), false);
    assert.equal(res.statusCode, 401);
    assert.equal(req.verifiedAddress, undefined);
  });

  it("funded route: bare account_ address, expired/invalid token → 401", async () => {
    const req = mkReq({ authorization: "Bearer " + "0".repeat(64) }, { address: ADDR });
    const res = mkRes();
    const mw = requireAuth({ mode: "required-for-wallets" });
    assert.equal(await runMw(mw, req, res), false);
    assert.equal(res.statusCode, 401);
  });

  it("funded route: account_ address with a valid session → 200 and req.verifiedAddress set", async () => {
    const s = issueSession({ radix_address: ADDR });
    const req = mkReq({ authorization: `Bearer ${s.token}` }, { address: ADDR });
    const res = mkRes();
    const mw = requireAuth({ mode: "required-for-wallets" });
    assert.equal(await runMw(mw, req, res), true);
    assert.equal(res.statusCode, 200); // never touched
    assert.equal(req.verifiedAddress, ADDR);
  });

  it("guest id path is unaffected — trusted from the URL like legacy, no session needed", async () => {
    const req = mkReq({}, { address: GUEST_ID });
    const res = mkRes();
    const mw = requireAuth({ mode: "required-for-wallets" });
    assert.equal(await runMw(mw, req, res), true);
    assert.equal(req.verifiedAddress, GUEST_ID);
  });

  it("guest id path is unaffected even carrying a garbage bearer token", async () => {
    const req = mkReq({ authorization: "Bearer " + "1".repeat(64) }, { address: GUEST_ID });
    const res = mkRes();
    const mw = requireAuth({ mode: "required-for-wallets" });
    assert.equal(await runMw(mw, req, res), true);
    assert.equal(req.verifiedAddress, GUEST_ID);
  });

  it("session/URL mismatch still 403s under required-for-wallets", async () => {
    const s = issueSession({ radix_address: ADDR });
    const req = mkReq({ authorization: `Bearer ${s.token}` }, { address: OTHER });
    const res = mkRes();
    const mw = requireAuth({ mode: "required-for-wallets" });
    assert.equal(await runMw(mw, req, res), false);
    assert.equal(res.statusCode, 403);
  });

  it("env mode override precedence: explicit opts.mode wins even when env says legacy", async () => {
    process.env.ROLA_AUTH_MODE = "legacy"; // env would allow this through
    const req = mkReq({}, { address: ADDR });
    const res = mkRes();
    const mw = requireAuth({ mode: "required-for-wallets" }); // route pins its own mode
    assert.equal(await runMw(mw, req, res), false);
    assert.equal(res.statusCode, 401);
  });

  it("env mode override precedence: no opts.mode falls back to env's required-for-wallets", async () => {
    process.env.ROLA_AUTH_MODE = "required-for-wallets";
    const req = mkReq({}, { address: ADDR });
    const res = mkRes();
    const mw = requireAuth(); // no override — must read the env value
    assert.equal(await runMw(mw, req, res), false);
    assert.equal(res.statusCode, 401);
  });

  it("env mode override precedence: an unrelated route's opts.mode='legacy' is unaffected by a global required-for-wallets env", async () => {
    process.env.ROLA_AUTH_MODE = "required-for-wallets";
    const req = mkReq({}, { address: ADDR });
    const res = mkRes();
    const mw = requireAuth({ mode: "legacy" }); // this route explicitly opts out
    assert.equal(await runMw(mw, req, res), true);
    assert.equal(req.verifiedAddress, ADDR);
  });
});
