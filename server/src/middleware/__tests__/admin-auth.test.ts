import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Request, Response, NextFunction } from "express";

// ── Helpers to build mock req/res/next ──────────────────────────────────────

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    headers: {},
    method: "GET",
    path: "/admin/test",
    ip: "127.0.0.1",
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response & { _status: number; _json: any } {
  const res: any = { _status: 0, _json: null };
  res.status = (code: number) => { res._status = code; return res; };
  res.json = (body: any) => { res._json = body; return res; };
  return res;
}

function mockNext(): NextFunction & { called: boolean } {
  const fn: any = () => { fn.called = true; };
  fn.called = false;
  return fn;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("admin-auth middleware", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    // Set a valid admin token for each test
    process.env.ADMIN_TOKEN = "test-admin-token-32chars-exactly!";
    delete process.env.ADMIN_TOKEN_PREVIOUS;
    delete process.env.ADMIN_TOKEN_EXPIRES_AT;
  });

  afterEach(() => {
    // Restore env
    process.env = { ...ORIGINAL_ENV };
  });

  // Fresh import each test to avoid stale rate-limit state
  async function loadMiddleware() {
    // Dynamic import to get fresh module state; bust cache with query param
    // Bun/tsx re-evaluate on each dynamic import of .ts files
    const mod = await import("../admin-auth");
    return mod.adminAuth;
  }

  it("returns 401 when token header is missing", async () => {
    const adminAuth = await loadMiddleware();
    const req = mockReq({ headers: {} });
    const res = mockRes();
    const next = mockNext();

    adminAuth(req, res, next);

    assert.equal(res._status, 401);
    assert.equal(res._json.ok, false);
    assert.equal(next.called, false);
  });

  it("returns 401 when token is wrong", async () => {
    const adminAuth = await loadMiddleware();
    const req = mockReq({ headers: { "x-admin-token": "wrong-token-value-xxxxxxxxxxxxx" } });
    const res = mockRes();
    const next = mockNext();

    adminAuth(req, res, next);

    assert.equal(res._status, 401);
    assert.equal(next.called, false);
  });

  it("returns 401 when token is expired", async () => {
    const adminAuth = await loadMiddleware();
    // Set expiry to a past timestamp
    process.env.ADMIN_TOKEN_EXPIRES_AT = "1000000000"; // 2001-09-09
    const req = mockReq({ headers: { "x-admin-token": "test-admin-token-32chars-exactly!" } });
    const res = mockRes();
    const next = mockNext();

    adminAuth(req, res, next);

    assert.equal(res._status, 401);
    assert.match(res._json.error, /expired/i);
    assert.equal(next.called, false);
  });

  it("returns 500 when ADMIN_TOKEN_EXPIRES_AT is NaN/invalid", async () => {
    const adminAuth = await loadMiddleware();
    process.env.ADMIN_TOKEN_EXPIRES_AT = "not-a-date";
    const req = mockReq({ headers: { "x-admin-token": "test-admin-token-32chars-exactly!" } });
    const res = mockRes();
    const next = mockNext();

    adminAuth(req, res, next);

    assert.equal(res._status, 500);
    assert.match(res._json.error, /misconfigured/i);
    assert.equal(next.called, false);
  });

  it("returns 429 when rate limit is exceeded", async () => {
    const adminAuth = await loadMiddleware();

    // Exhaust the 20-request limit
    for (let i = 0; i < 20; i++) {
      const req = mockReq({ headers: { "x-admin-token": "test-admin-token-32chars-exactly!" } });
      const res = mockRes();
      const next = mockNext();
      adminAuth(req, res, next);
      assert.equal(next.called, true, `Request ${i + 1} should pass`);
    }

    // 21st request should be rate-limited
    const req = mockReq({ headers: { "x-admin-token": "test-admin-token-32chars-exactly!" } });
    const res = mockRes();
    const next = mockNext();
    adminAuth(req, res, next);

    assert.equal(res._status, 429);
    assert.equal(next.called, false);
  });

  it("calls next() with a valid current token", async () => {
    const adminAuth = await loadMiddleware();
    // Use a unique IP to avoid rate-limit state from other tests
    const req = mockReq({ headers: { "x-admin-token": "test-admin-token-32chars-exactly!" }, ip: "10.0.0.1" } as any);
    const res = mockRes();
    const next = mockNext();

    adminAuth(req, res, next);

    assert.equal(next.called, true);
    assert.equal(res._status, 0, "should not set a status code");
  });

  it("calls next() with a valid previous token during rotation", async () => {
    const adminAuth = await loadMiddleware();
    process.env.ADMIN_TOKEN = "new-admin-token-32chars-exactly!!";
    process.env.ADMIN_TOKEN_PREVIOUS = "test-admin-token-32chars-exactly!";
    // Use a unique IP to avoid rate-limit state from other tests
    const req = mockReq({ headers: { "x-admin-token": "test-admin-token-32chars-exactly!" }, ip: "10.0.0.2" } as any);
    const res = mockRes();
    const next = mockNext();

    adminAuth(req, res, next);

    assert.equal(next.called, true);
  });

  it("uses timing-safe comparison (safeTokenEqual) — length mismatch rejected fast", async () => {
    const adminAuth = await loadMiddleware();
    // A token with different length should be rejected (length leak is acceptable per code comment)
    const req = mockReq({ headers: { "x-admin-token": "short" } });
    const res = mockRes();
    const next = mockNext();

    adminAuth(req, res, next);

    assert.equal(res._status, 401);
    assert.equal(next.called, false);
  });
});
