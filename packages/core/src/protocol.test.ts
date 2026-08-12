import { describe, it, expect } from "vitest";
import {
  generateIdentityKeyPair,
  generateAgreementKeyPair,
  fingerprint,
  sealTo,
  openSealed,
  generateGroupKey,
  wrapGroupKey,
  unwrapGroupKey,
  encryptMessage,
  decryptMessage,
  signMessage,
  verifyMessage,
  messageSigningBytes,
  chainHash,
  encodeInvite,
  parseInvite,
  didKeyFromEd25519,
  ed25519FromDidKey,
  type EnvelopeContext,
  type SignableEnvelope,
} from "./index";

describe("sealed box", () => {
  it("round-trips to the recipient", () => {
    const recipient = generateAgreementKeyPair();
    const secret = new TextEncoder().encode("group-key-material");
    const sealed = sealTo(recipient.publicKey, secret);
    expect(openSealed(sealed, recipient)).toEqual(secret);
  });

  it("cannot be opened by a different keypair", () => {
    const recipient = generateAgreementKeyPair();
    const attacker = generateAgreementKeyPair();
    const sealed = sealTo(recipient.publicKey, new Uint8Array([1, 2, 3]));
    expect(() => openSealed(sealed, attacker)).toThrow();
  });
});

describe("group key wrapping (multi-party)", () => {
  it("wraps to each member and every member unwraps the same key", () => {
    const gk = generateGroupKey();
    expect(gk).toHaveLength(32);
    const members = [generateAgreementKeyPair(), generateAgreementKeyPair(), generateAgreementKeyPair()];
    for (const m of members) {
      const wrapped = wrapGroupKey(gk, m.publicKey);
      expect(unwrapGroupKey(wrapped, m)).toEqual(gk);
    }
  });
});

describe("message encryption", () => {
  const ctx: EnvelopeContext = { sessionId: "rdv_abc", epoch: 0, senderId: "aa00" };

  it("round-trips under the group key", () => {
    const gk = generateGroupKey();
    const enc = encryptMessage(gk, ctx, "final offer: 18000");
    expect(decryptMessage(gk, ctx, enc)).toBe("final offer: 18000");
  });

  it("fails to decrypt with a wrong group key", () => {
    const enc = encryptMessage(generateGroupKey(), ctx, "secret");
    expect(() => decryptMessage(generateGroupKey(), ctx, enc)).toThrow();
  });

  it("fails to decrypt if associated data (context) is altered", () => {
    const gk = generateGroupKey();
    const enc = encryptMessage(gk, ctx, "secret");
    expect(() => decryptMessage(gk, { ...ctx, epoch: 1 }, enc)).toThrow();
  });
});

describe("message signing (non-repudiation)", () => {
  const gk = generateGroupKey();
  const ctx: EnvelopeContext = { sessionId: "rdv_abc", epoch: 0, senderId: "aa00" };

  function envelope(): SignableEnvelope {
    const enc = encryptMessage(gk, ctx, "I accept these terms");
    return { ...ctx, type: "accept", prevHash: null, nonce: enc.nonce, ciphertext: enc.ciphertext };
  }

  it("verifies a signed envelope and rejects a tampered one", () => {
    const id = generateIdentityKeyPair();
    const env = envelope();
    const sig = signMessage(env, id.privateKey);
    expect(verifyMessage(env, sig, id.publicKey)).toBe(true);

    const tampered: SignableEnvelope = { ...env, type: "reject" };
    expect(verifyMessage(tampered, sig, id.publicKey)).toBe(false);
  });

  it("rejects a signature from a different identity", () => {
    const id = generateIdentityKeyPair();
    const other = generateIdentityKeyPair();
    const env = envelope();
    const sig = signMessage(env, id.privateKey);
    expect(verifyMessage(env, sig, other.publicKey)).toBe(false);
  });

  it("chain hash is order-sensitive", () => {
    const a = messageSigningBytes(envelope());
    const b = messageSigningBytes(envelope());
    expect(chainHash(chainHash(null, a), b)).not.toEqual(chainHash(chainHash(null, b), a));
  });
});

describe("invite codec", () => {
  it("round-trips", () => {
    const invite = { sessionId: "rdv_abc", fingerprint: "deadbeef", joinToken: "tok123" };
    expect(parseInvite(encodeInvite(invite))).toEqual(invite);
  });

  it("rejects malformed invites", () => {
    expect(() => parseInvite("nope:rdv_abc:fp:tok")).toThrow();
    expect(() => parseInvite("randevu:rdv_abc:fp")).toThrow();
  });

  it("rejects fields containing the separator", () => {
    expect(() => encodeInvite({ sessionId: "rdv:abc", fingerprint: "fp", joinToken: "tok" })).toThrow();
  });
});

describe("did:key (RDV-29 interop)", () => {
  it("round-trips an ed25519 identity key", () => {
    const id = generateIdentityKeyPair();
    const did = didKeyFromEd25519(id.publicKey);
    expect(did.startsWith("did:key:z")).toBe(true);
    expect(ed25519FromDidKey(did)).toEqual(id.publicKey);
  });

  it("rejects a non-did:key string", () => {
    expect(() => ed25519FromDidKey("did:web:example.com")).toThrow();
  });

  it("fingerprint of the key is stable", () => {
    const id = generateIdentityKeyPair();
    expect(fingerprint(id.publicKey)).toBe(fingerprint(ed25519FromDidKey(didKeyFromEd25519(id.publicKey))));
  });
});
