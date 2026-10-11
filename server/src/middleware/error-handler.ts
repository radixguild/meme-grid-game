import type { Request, Response, NextFunction } from "express";

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  // Log full error server-side only
  if (process.env.NODE_ENV !== "test") {
    console.error("[error]", err.message);
  }

  const status = (err as any).status || 500;

  // Never leak internal error details to clients
  res.status(status).json({
    ok: false,
    error: status === 500 ? "Internal server error" : err.message,
  });
}
