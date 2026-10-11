import type { Request, Response, NextFunction } from "express";

const windows = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 60_000;
const MAX_GET = 120;
const MAX_POST = 60; // Game rolls need higher limit

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || "unknown";
  const method = req.method;
  const key = `${ip}:${method}`;
  const max = method === "POST" ? MAX_POST : MAX_GET;
  const now = Date.now();

  let window = windows.get(key);
  if (!window || now > window.resetAt) {
    window = { count: 0, resetAt: now + WINDOW_MS };
    windows.set(key, window);
  }

  window.count++;
  if (window.count > max) {
    res.status(429).json({ ok: false, error: "Rate limit exceeded. Try again later." });
    return;
  }
  next();
}

// Cleanup stale windows every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, window] of windows) {
    if (now > window.resetAt) windows.delete(key);
  }
}, 5 * 60_000);
