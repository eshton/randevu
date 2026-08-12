import { describe, it, expect } from "vitest";
import {
  generateIdentityKeyPair,
  generateAgreementKeyPair,
  sign,
  verify,
  fingerprint,
} from "./index";

describe("@randevu/core crypto", () => {
  it("generates a 32-byte ed25519 identity keypair", () => {
    const kp = generateIdentityKeyPair();
    expect(kp.privateKey).toHaveLength(32);
    expect(kp.publicKey).toHaveLength(32);
  });

  it("generates a 32-byte x25519 agreement keypair", () => {
    const kp = generateAgreementKeyPair();
    expect(kp.privateKey).toHaveLength(32);
    expect(kp.publicKey).toHaveLength(32);
  });

  it("signs and verifies (non-repudiation primitive)", () => {
    const kp = generateIdentityKeyPair();
    const msg = new TextEncoder().encode("final offer: 18000");
    const sig = sign(msg, kp.privateKey);
    expect(verify(sig, msg, kp.publicKey)).toBe(true);

    const tampered = new TextEncoder().encode("final offer: 8000");
    expect(verify(sig, tampered, kp.publicKey)).toBe(false);
  });

  it("fingerprint is deterministic 32-hex-char (16 bytes)", () => {
    const kp = generateIdentityKeyPair();
    const fp = fingerprint(kp.publicKey);
    expect(fp).toBe(fingerprint(kp.publicKey));
    expect(fp).toMatch(/^[0-9a-f]{32}$/);
  });
});
