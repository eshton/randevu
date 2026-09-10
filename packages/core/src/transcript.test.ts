import { describe, it, expect } from "vitest";
import { bytesToHex } from "@noble/hashes/utils";
import {
  generateIdentityKeyPair,
  fingerprint,
  didKeyFromEd25519,
  generateGroupKey,
  encryptMessage,
  signMessage,
  messageSigningBytes,
  chainHash,
  verifyTranscript,
  signTranscriptHead,
  type SignableEnvelope,
  type TranscriptBundle,
  type MessageType,
} from "./index";
import { bytesToHex as toHex } from "@noble/hashes/utils";

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
        ref: null,
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

  it("returns invalid (not throws) on malformed hex fields", () => {
    const b = buildBundle();
    b.messages[0]!.ciphertext = "zz-not-hex";
    let v!: ReturnType<typeof verifyTranscript>;
    expect(() => {
      v = verifyTranscript(b);
    }).not.toThrow();
    expect(v.valid).toBe(false);
  });

  it("returns invalid (not throws) on a corrupt/empty bundle", () => {
    expect(() => verifyTranscript({} as TranscriptBundle)).not.toThrow();
    expect(verifyTranscript({} as TranscriptBundle).valid).toBe(false);
  });
});

describe("signed transcript head (tail-truncation)", () => {
  // Build a 2-message bundle plus a signed head over the final (lastSeq, headHash).
  function buildHeaded() {
    const sessionId = "rdv_h";
    const k = generateIdentityKeyPair();
    const gk = generateGroupKey();
    const senderId = fingerprint(k.publicKey);
    const msgs: TranscriptBundle["messages"] = [];
    let prev: Uint8Array | null = null;
    for (let seq = 1; seq <= 2; seq++) {
      const ctx = { sessionId, epoch: 0, senderId };
      const enc = encryptMessage(gk, ctx, `m${seq}`);
      const env: SignableEnvelope = { ...ctx, type: "message" as MessageType, prevHash: prev, ref: null, nonce: enc.nonce, ciphertext: enc.ciphertext };
      const sb = messageSigningBytes(env);
      msgs.push({
        seq, epoch: 0, senderId, type: "message",
        nonce: toHex(enc.nonce), ciphertext: toHex(enc.ciphertext),
        prevHash: prev ? toHex(prev) : null, ref: null, signature: toHex(signMessage(env, k.privateKey)),
      });
      prev = chainHash(prev, sb);
    }
    const headHash = toHex(prev!);
    const bundle: TranscriptBundle = {
      version: "randevu-transcript/v1",
      sessionId,
      members: [{ fingerprint: senderId, did: didKeyFromEd25519(k.publicKey), identityPub: toHex(k.publicKey) }],
      groupKeys: [{ epoch: 0, key: toHex(gk) }],
      messages: msgs,
      head: signTranscriptHead(sessionId, 2, headHash, senderId, k.privateKey),
    };
    return bundle;
  }

  it("validates a well-formed signed head", () => {
    const v = verifyTranscript(buildHeaded());
    expect(v.valid).toBe(true);
    expect(v.headValid).toBe(true);
  });

  it("detects a dropped tail (fewer messages than the head commits to)", () => {
    const b = buildHeaded();
    b.messages = b.messages.slice(0, 1); // relay drops the last message but keeps the head
    const v = verifyTranscript(b);
    expect(v.headValid).toBe(false);
    expect(v.valid).toBe(false);
  });

  it("rejects a tampered head signature", () => {
    const b = buildHeaded();
    const s = b.head!.signature;
    b.head!.signature = s.slice(0, -1) + (s.endsWith("0") ? "1" : "0");
    expect(verifyTranscript(b).headValid).toBe(false);
  });

  it("leaves headValid undefined when no head is present (older exports)", () => {
    const b = buildHeaded();
    delete b.head;
    const v = verifyTranscript(b);
    expect(v.headValid).toBeUndefined();
    expect(v.valid).toBe(true);
  });
});
