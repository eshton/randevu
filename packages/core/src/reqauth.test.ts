import { describe, it, expect } from "vitest";
import { generateIdentityKeyPair, requestCanonical, signRequest, verifyRequest } from "./index";

describe("request auth (RDV-32)", () => {
  it("builds a stable canonical descriptor", () => {
    expect(requestCanonical("GET", "/sessions/rdv_x/status", "123")).toBe(
      "randevu/req/v1|GET|/sessions/rdv_x/status|123",
    );
  });

  it("signs and verifies a request", () => {
    const id = generateIdentityKeyPair();
    const canon = requestCanonical("POST", "/sessions/rdv_x/messages", "1000");
    const sig = signRequest(id.privateKey, canon);
    expect(verifyRequest(id.publicKey, canon, sig)).toBe(true);
  });

  it("rejects a signature verified against a different key", () => {
    const id = generateIdentityKeyPair();
    const canon = requestCanonical("GET", "/x", "1");
    const sig = signRequest(id.privateKey, canon);
    expect(verifyRequest(generateIdentityKeyPair().publicKey, canon, sig)).toBe(false);
  });

  it("rejects a signature over a different canonical (method/path/timestamp bound)", () => {
    const id = generateIdentityKeyPair();
    const sig = signRequest(id.privateKey, requestCanonical("GET", "/a", "1"));
    expect(verifyRequest(id.publicKey, requestCanonical("GET", "/a", "2"), sig)).toBe(false);
    expect(verifyRequest(id.publicKey, requestCanonical("POST", "/a", "1"), sig)).toBe(false);
    expect(verifyRequest(id.publicKey, requestCanonical("GET", "/b", "1"), sig)).toBe(false);
  });

  it("returns false (not throws) on malformed signature hex", () => {
    const id = generateIdentityKeyPair();
    expect(verifyRequest(id.publicKey, requestCanonical("GET", "/a", "1"), "zz-not-hex")).toBe(false);
    expect(verifyRequest(id.publicKey, requestCanonical("GET", "/a", "1"), "")).toBe(false);
  });
});
