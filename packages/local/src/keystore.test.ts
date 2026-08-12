import { describe, it, expect } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync, unlinkSync } from "node:fs";
import { bytesToHex, randomBytes } from "@noble/hashes/utils";
import { generateIdentityKeyPair, generateAgreementKeyPair } from "@randevu/core";
import { encodeKeystore, decodeKeystore, loadOrCreateKeystore, RandevuLocal } from "./index";

function newKeys() {
  return { identity: generateIdentityKeyPair(), agreement: generateAgreementKeyPair() };
}

describe("keystore (RDV-8)", () => {
  it("encodes and decodes round-trip with the right passphrase", () => {
    const keys = newKeys();
    const decoded = decodeKeystore(encodeKeystore(keys, "correct horse"), "correct horse");
    expect(bytesToHex(decoded.identity.privateKey)).toBe(bytesToHex(keys.identity.privateKey));
    expect(bytesToHex(decoded.agreement.publicKey)).toBe(bytesToHex(keys.agreement.publicKey));
  });

  it("fails to decode with a wrong passphrase", () => {
    const file = encodeKeystore(newKeys(), "right");
    expect(() => decodeKeystore(file, "wrong")).toThrow();
  });

  it("persists a stable identity across loads", () => {
    const path = join(tmpdir(), `rdv-keystore-${bytesToHex(randomBytes(6))}.json`);
    try {
      const k1 = loadOrCreateKeystore(path, "pw");
      const k2 = loadOrCreateKeystore(path, "pw");
      expect(bytesToHex(k1.identity.publicKey)).toBe(bytesToHex(k2.identity.publicKey));
      expect(() => loadOrCreateKeystore(path, "different")).toThrow();
    } finally {
      if (existsSync(path)) unlinkSync(path);
    }
  });

  it("gives RandevuLocal a stable memberId from persisted keys", () => {
    const keys = newKeys();
    const a = new RandevuLocal({ relayUrl: "https://relay.example.com", keys });
    const b = new RandevuLocal({ relayUrl: "https://relay.example.com", keys });
    expect(a.memberId).toBe(b.memberId);
  });
});
