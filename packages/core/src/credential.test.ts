import { describe, it, expect } from "vitest";
import {
  generateIdentityKeyPair,
  didKeyFromEd25519,
  ed25519FromDidKey,
  signCredential,
  verifyCredential,
} from "./index";

function baseCredential(did: string) {
  return {
    "@context": ["https://www.w3.org/2018/credentials/v1"],
    type: ["VerifiableCredential", "RandevuAgreement"],
    issuer: did,
    credentialSubject: { accepted: "Price 18000, delivery 30 days" },
  };
}

describe("verifiable credential (RDV-29)", () => {
  it("signs and verifies, resolving the issuer via did:key", () => {
    const id = generateIdentityKeyPair();
    const did = didKeyFromEd25519(id.publicKey);
    const vc = signCredential(baseCredential(did), did, id.privateKey);
    expect(verifyCredential(vc, ed25519FromDidKey(vc["issuer"] as string))).toBe(true);
  });

  it("rejects a tampered credentialSubject", () => {
    const id = generateIdentityKeyPair();
    const did = didKeyFromEd25519(id.publicKey);
    const vc = signCredential(baseCredential(did), did, id.privateKey);
    (vc["credentialSubject"] as { accepted: string }).accepted = "Price 1";
    expect(verifyCredential(vc, id.publicKey)).toBe(false);
  });

  it("rejects a wrong issuer key", () => {
    const id = generateIdentityKeyPair();
    const did = didKeyFromEd25519(id.publicKey);
    const vc = signCredential(baseCredential(did), did, id.privateKey);
    expect(verifyCredential(vc, generateIdentityKeyPair().publicKey)).toBe(false);
  });
});
