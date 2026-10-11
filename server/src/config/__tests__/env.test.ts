import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { getNetwork } from "../env";

// getNetwork() is the server's ONLY source for which network it is on. The
// bug it replaces read NEXT_PUBLIC_NETWORK, or fell back to a hardcoded
// "mainnet" — NEXT_PUBLIC_NETWORK is a Next.js build-time FRONTEND var,
// written to .env.local and never present in the server's own env, so both
// paths reported "mainnet" regardless of what RADIX_NETWORK actually said.

describe("getNetwork", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.RADIX_NETWORK;
    delete process.env.NEXT_PUBLIC_NETWORK;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("returns the configured RADIX_NETWORK", () => {
    process.env.RADIX_NETWORK = "stokenet";
    assert.equal(getNetwork(), "stokenet");
  });

  it("normalises case and surrounding whitespace", () => {
    process.env.RADIX_NETWORK = "  Mainnet \n";
    assert.equal(getNetwork(), "mainnet");
  });

  it("returns null when unset — never guesses a default", () => {
    assert.equal(getNetwork(), null);
  });

  it("ignores NEXT_PUBLIC_NETWORK entirely", () => {
    process.env.NEXT_PUBLIC_NETWORK = "mainnet";
    // RADIX_NETWORK still unset: the frontend var must not leak in as a
    // fallback, however plausible-looking its value is.
    assert.equal(getNetwork(), null);
  });

  it("treats an empty string the same as unset", () => {
    process.env.RADIX_NETWORK = "   ";
    assert.equal(getNetwork(), null);
  });
});
