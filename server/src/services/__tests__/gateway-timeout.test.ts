/**
 * A Gateway call that never answers must end with a TimeoutError instead of
 * holding its caller open indefinitely. The Gateway is a local stub that accepts
 * the request and says nothing; GATEWAY_URL is read at module load, so it is set
 * before the module is imported.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

const silent = http.createServer((req) => {
  req.resume(); // read the body, never reply
});

let gateway: typeof import("../gateway");

describe("services/gateway timeout", () => {
  before(async () => {
    silent.listen(0);
    await new Promise<void>((resolve) => silent.once("listening", resolve));
    process.env.GATEWAY_URL = `http://127.0.0.1:${(silent.address() as AddressInfo).port}`;
    gateway = await import("../gateway");
  });

  after(async () => {
    gateway.setGatewayTimeoutForTests();
    silent.closeAllConnections();
    await new Promise<void>((resolve) => silent.close(() => resolve()));
  });

  it("the default timeout is finite and short enough to matter", () => {
    assert.ok(gateway.GATEWAY_TIMEOUT_MS >= 1_000 && gateway.GATEWAY_TIMEOUT_MS <= 60_000);
  });

  it("holdings lookup rejects with a TimeoutError when the Gateway never answers", { timeout: 10_000 }, async () => {
    gateway.setGatewayTimeoutForTests(500);
    const started = Date.now();
    await assert.rejects(gateway.getAccountHoldings("account_rdx1test"), { name: "TimeoutError" });
    assert.ok(Date.now() - started < 5_000);
  });

  it("transaction details and the status call time out too", { timeout: 10_000 }, async () => {
    gateway.setGatewayTimeoutForTests(500);
    await assert.rejects(gateway.getTransactionDetails("txid_rdx1test"), { name: "TimeoutError" });
    await assert.rejects(gateway.getNetworkStatus(), { name: "TimeoutError" });
  });
});
