import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Request, Response } from "express";
import { createApp } from "../app";

// Production runs behind Caddy, which appends the real client IP to
// X-Forwarded-For. Without `trust proxy`, `req.ip` is the socket peer (::1 for
// every proxied request), which collapses the per-IP rate limiter in
// middleware/rate-limit.ts into ONE shared bucket for the entire player base.
//
// The setting must be `1`, never `true`: with `true` Express walks to the
// left-most X-Forwarded-For entry, which is client-supplied, letting a player
// forge their own IP and mint unlimited rate-limit buckets.

async function ipFor(headers: Record<string, string>): Promise<string> {
  const app = createApp();
  // Registered after createApp()'s error handler; Express only dispatches to
  // 4-arg error middleware on an error, so a normal GET still reaches this.
  app.get("/__probe", (req: Request, res: Response) => {
    res.json({ ip: req.ip });
  });

  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const { port } = server.address() as AddressInfo;
    const r = await fetch(`http://127.0.0.1:${port}/__probe`, { headers });
    const body = (await r.json()) as { ip: string };
    return body.ip;
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe("trust proxy", () => {
  it("is set to exactly 1 — not true, which would trust client-forged hops", () => {
    const app = createApp();
    assert.equal(app.get("trust proxy"), 1);
    assert.notEqual(app.get("trust proxy"), true);
  });

  it("uses the IP the nearest proxy appended, so rate-limit buckets are per player", async () => {
    const ip = await ipFor({ "X-Forwarded-For": "203.0.113.7" });
    assert.equal(ip, "203.0.113.7");
  });

  it("ignores client-forged left-most hops and keeps the proxy-written IP", async () => {
    // A player sending "X-Forwarded-For: 1.2.3.4" gets it rewritten by Caddy to
    // "1.2.3.4, <real client ip>". With trust proxy = 1 we take the right-most
    // (proxy-written) value, so the forged 1.2.3.4 must NOT win.
    const ip = await ipFor({ "X-Forwarded-For": "1.2.3.4, 203.0.113.9" });
    assert.equal(ip, "203.0.113.9");
    assert.notEqual(ip, "1.2.3.4");
  });

  it("distinguishes two different players behind the same proxy", async () => {
    const a = await ipFor({ "X-Forwarded-For": "198.51.100.1" });
    const b = await ipFor({ "X-Forwarded-For": "198.51.100.2" });
    assert.notEqual(a, b);
  });
});
