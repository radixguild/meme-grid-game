import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { systemInfo } from "../admin";

// The admin dashboard renders system.network as the network this server
// process is on. It must come from the server's own RADIX_NETWORK, never
// from a frontend NEXT_PUBLIC_* var (absent from the server env in every
// real deployment) or a hardcoded default — either of those reports
// "mainnet" on a stokenet box, exactly when an operator is relying on the
// panel to know which network they are looking at.

describe("admin stats — system block", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.RADIX_NETWORK;
    delete process.env.NEXT_PUBLIC_NETWORK;
    delete process.env.VAULT_COMPONENT;
    delete process.env.MEME_RESOURCE;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("reports the network the server was actually booted with", () => {
    process.env.RADIX_NETWORK = "stokenet";
    assert.equal(systemInfo().network, "stokenet");
  });

  it("does not report mainnet on a stokenet server because of NEXT_PUBLIC_NETWORK", () => {
    process.env.RADIX_NETWORK = "stokenet";
    process.env.NEXT_PUBLIC_NETWORK = "mainnet";
    assert.equal(systemInfo().network, "stokenet");
  });

  it("says unknown, not mainnet, when RADIX_NETWORK is unset", () => {
    assert.equal(systemInfo().network, "unknown");
  });

  it("reports vault_component and meme_resource as null when unset", () => {
    const info = systemInfo();
    assert.equal(info.vault_component, null);
    assert.equal(info.meme_resource, null);
  });

  it("passes through vault_component and meme_resource when set", () => {
    process.env.VAULT_COMPONENT = "component_rdx1test";
    process.env.MEME_RESOURCE = "resource_rdx1test";
    const info = systemInfo();
    assert.equal(info.vault_component, "component_rdx1test");
    assert.equal(info.meme_resource, "resource_rdx1test");
  });
});
