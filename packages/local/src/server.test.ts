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
});
