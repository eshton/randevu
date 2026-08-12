import { describe, it, expect } from "vitest";
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
});
