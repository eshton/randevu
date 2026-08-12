import { describe, it, expect } from "vitest";
import { bytesToHex } from "@noble/hashes/utils";
import {
  generateIdentityKeyPair,
  fingerprint,
  didKeyFromEd25519,
  generateGroupKey,
  encryptMessage,
  signMessage,
  verifyTranscript,
  type SignableEnvelope,
  type TranscriptBundle,
  type MessageType,
} from "./index";

function buildBundle(): TranscriptBundle {
  const sessionId = "rdv_t";
  const alice = generateIdentityKeyPair();
  const gk = generateGroupKey();
  const senderId = fingerprint(alice.publicKey);
  const ctx = { sessionId, epoch: 0, senderId };
  const enc = encryptMessage(gk, ctx, "hello");
  const env: SignableEnvelope = {
    ...ctx,
    type: "message" as MessageType,
    prevHash: null,
    nonce: enc.nonce,
    ciphertext: enc.ciphertext,
  };
  const sig = signMessage(env, alice.privateKey);
  return {
    version: "randevu-transcript/v1",
    sessionId,
    members: [
      { fingerprint: senderId, did: didKeyFromEd25519(alice.publicKey), identityPub: bytesToHex(alice.publicKey) },
    ],
    groupKeys: [{ epoch: 0, key: bytesToHex(gk) }],
    messages: [
      {
        seq: 1,
        epoch: 0,
        senderId,
        type: "message",
        nonce: bytesToHex(enc.nonce),
        ciphertext: bytesToHex(enc.ciphertext),
        prevHash: null,
        signature: bytesToHex(sig),
      },
    ],
  };
}

describe("verifyTranscript", () => {
  it("validates a well-formed bundle and recovers plaintext", () => {
    const v = verifyTranscript(buildBundle());
    expect(v.valid).toBe(true);
    expect(v.membersValid).toBe(true);
    expect(v.messages[0]!.body).toBe("hello");
    expect(v.messages[0]!.signatureValid).toBe(true);
    expect(v.messages[0]!.chainValid).toBe(true);
  });

  it("flags a tampered signature", () => {
    const b = buildBundle();
    const sig = b.messages[0]!.signature;
    b.messages[0]!.signature = sig.slice(0, -1) + (sig.endsWith("0") ? "1" : "0");
    const v = verifyTranscript(b);
    expect(v.valid).toBe(false);
    expect(v.messages[0]!.signatureValid).toBe(false);
  });

  it("flags a broken chain (unexpected prevHash)", () => {
    const b = buildBundle();
    b.messages[0]!.prevHash = bytesToHex(new Uint8Array(32));
    const v = verifyTranscript(b);
    expect(v.valid).toBe(false);
    expect(v.messages[0]!.chainValid).toBe(false);
  });

  it("flags a member whose fingerprint doesn't match its key", () => {
    const b = buildBundle();
    b.members[0]!.fingerprint = "deadbeef";
    const v = verifyTranscript(b);
    expect(v.membersValid).toBe(false);
    expect(v.valid).toBe(false);
  });
});
