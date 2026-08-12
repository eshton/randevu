import { describe, it, expect } from "vitest";
import { verifyCredential, ed25519FromDidKey } from "@randevu/core";
import { RandevuLocal, LOCAL_VERSION } from "./index";

describe("@randevu/local", () => {
  it("exposes a version", () => {
    expect(typeof LOCAL_VERSION).toBe("string");
  });

  it("generates an identity (memberId + did) without touching the network", () => {
    const local = new RandevuLocal({ relayUrl: "https://relay.example.com" });
    expect(local.memberId).toMatch(/^[0-9a-f]{32}$/);
    expect(local.did.startsWith("did:key:z")).toBe(true);
  });

  it("issues a verifiable credential signed by its identity (RDV-29)", () => {
    const local = new RandevuLocal({ relayUrl: "https://relay.example.com" });
    const vc = local.issueCredential({ accepted: "terms" });
    expect(verifyCredential(vc, ed25519FromDidKey(local.did))).toBe(true);
  });

  it("emits an AP2 cart mandate as a verifiable credential (RDV-31)", () => {
    const local = new RandevuLocal({ relayUrl: "https://relay.example.com" });
    const vc = local.issueMandate("cart", { items: [{ sku: "A", price: "100" }], total: "100" });
    expect(vc["type"] as string[]).toContain("CartMandate");
    expect(verifyCredential(vc, ed25519FromDidKey(local.did))).toBe(true);
  });

  it("builds an x402 payment-required descriptor (RDV-31)", () => {
    const local = new RandevuLocal({ relayUrl: "https://relay.example.com" });
    const req = local.x402PaymentRequired({ amount: "100", asset: "USDC", network: "base", payTo: "0xabc", resource: "/deal/1" });
    const accepts = req["accepts"] as Array<{ maxAmountRequired: string; asset: string }>;
    expect(accepts[0]!.maxAmountRequired).toBe("100");
    expect(accepts[0]!.asset).toBe("USDC");
  });
});
