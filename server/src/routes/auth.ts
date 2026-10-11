/**
 * /api/auth — ROLA challenge/verify + session lifecycle
 *
 *   POST /api/auth/challenge
 *     → { challenge, expiresAt }
 *
 *   POST /api/auth/verify
 *     body { signedChallenge: SignedChallenge, origin: string }
 *     → { ok, token, expiresAt, address } on success
 *
 *   POST /api/auth/logout
 *     header Authorization: Bearer <token>
 *     → { ok }
 *
 *   GET /api/auth/me
 *     header Authorization: Bearer <token>
 *     → { address, expiresAt } or 401
 */

import { Router, type Request, type Response } from "express";
import { issue as issueChallenge, consume as consumeChallenge } from "../auth/challenge";
import { verifyProof, configSummary } from "../auth/rola";
import { issueSession, lookupSession, revokeSession, SESSION_TTL_SEC } from "../auth/session";

export const authRouter = Router();

authRouter.post("/challenge", (_req: Request, res: Response) => {
  const c = issueChallenge();
  res.json({ ok: true, ...c });
});

authRouter.post("/verify", async (req: Request, res: Response) => {
  const body = req.body as {
    signedChallenge?: {
      address?: string;
      type?: "account" | "persona";
      challenge?: string;
      proof?: { publicKey?: string; signature?: string; curve?: string };
    };
    origin?: string;
  };

  const sc = body?.signedChallenge;
  const origin = typeof body?.origin === "string" ? body.origin : "";

  // Shape check before any side-effects.
  if (
    !sc ||
    typeof sc.address !== "string" ||
    (sc.type !== "account" && sc.type !== "persona") ||
    typeof sc.challenge !== "string" ||
    !sc.proof ||
    typeof sc.proof.publicKey !== "string" ||
    typeof sc.proof.signature !== "string" ||
    (sc.proof.curve !== "curve25519" && sc.proof.curve !== "secp256k1")
  ) {
    res.status(400).json({ ok: false, error: "malformed signedChallenge" });
    return;
  }
  if (!origin) {
    res.status(400).json({ ok: false, error: "origin is required" });
    return;
  }

  // Only accept account proofs — persona proofs identify the persona, not
  // an account, and we're gating account-scoped endpoints.
  if (sc.type !== "account") {
    res.status(400).json({ ok: false, error: "account proof required" });
    return;
  }

  // Single-use: consume the challenge BEFORE signature verify to prevent
  // replay. If consume returns false, challenge is unknown/used/expired.
  const consumed = consumeChallenge(sc.challenge);
  if (!consumed) {
    res.status(400).json({ ok: false, error: "challenge invalid or already used" });
    return;
  }

  const result = await verifyProof({
    signedChallenge: sc as any,
    origin,
  });

  if (result.ok !== true) {
    const reason = "reason" in result ? result.reason : "verification failed";
    res.status(401).json({ ok: false, error: reason });
    return;
  }

  const session = issueSession({
    radix_address: sc.address,
    userAgent: req.headers["user-agent"] ?? null,
    origin,
  });

  res.json({
    ok: true,
    token: session.token,
    address: session.radix_address,
    expiresAt: session.expires_at,
    ttlSec: SESSION_TTL_SEC,
  });
});

authRouter.post("/logout", (req: Request, res: Response) => {
  const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(req.headers.authorization ?? "");
  if (!m) {
    res.status(401).json({ ok: false, error: "missing bearer token" });
    return;
  }
  const revoked = revokeSession(m[1]);
  res.json({ ok: true, revoked });
});

authRouter.get("/me", (req: Request, res: Response) => {
  const m = /^Bearer\s+([a-f0-9]{64})$/i.exec(req.headers.authorization ?? "");
  if (!m) {
    res.status(401).json({ ok: false, error: "missing bearer token" });
    return;
  }
  const session = lookupSession(m[1]);
  if (!session) {
    res.status(401).json({ ok: false, error: "invalid or expired session" });
    return;
  }
  res.json({
    ok: true,
    address: session.radix_address,
    expiresAt: session.expires_at,
  });
});

// Debug endpoint — only exposes config, never secrets. Useful during rollout.
authRouter.get("/config", (_req: Request, res: Response) => {
  res.json({ ok: true, rola: configSummary() });
});

export default authRouter;
