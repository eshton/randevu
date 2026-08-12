import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { sha256 } from "@noble/hashes/sha256";
import { randomBytes, concatBytes, utf8ToBytes, bytesToHex } from "@noble/hashes/utils";
import { bytesToUtf8 } from "@noble/ciphers/utils";
import { sign, verify } from "./crypto";

export type MessageType = "message" | "offer" | "counter" | "accept" | "reject";

export interface EncryptedMessage {
  /** 24-byte XChaCha20 nonce. */
  nonce: Uint8Array;
  /** AEAD ciphertext (includes the Poly1305 tag). */
  ciphertext: Uint8Array;
}

export interface EnvelopeContext {
  sessionId: string;
  epoch: number;
  /** Sender identity fingerprint. */
  senderId: string;
}

function associatedData(ctx: EnvelopeContext): Uint8Array {
  return utf8ToBytes(`randevu/v1|${ctx.sessionId}|${ctx.epoch}|${ctx.senderId}`);
}

/**
 * Encrypt plaintext under the epoch group key, binding session/epoch/sender as
 * AEAD associated data (prevents cross-context replay).
 */
export function encryptMessage(
  groupKey: Uint8Array,
  ctx: EnvelopeContext,
  plaintext: string,
): EncryptedMessage {
  const nonce = randomBytes(24);
  const ciphertext = xchacha20poly1305(groupKey, nonce, associatedData(ctx)).encrypt(
    utf8ToBytes(plaintext),
  );
  return { nonce, ciphertext };
}

/** Decrypt a message; throws if the AEAD tag or associated data doesn't verify. */
export function decryptMessage(
  groupKey: Uint8Array,
  ctx: EnvelopeContext,
  msg: EncryptedMessage,
): string {
  const plaintext = xchacha20poly1305(groupKey, msg.nonce, associatedData(ctx)).decrypt(
    msg.ciphertext,
  );
  return bytesToUtf8(plaintext);
}

export interface SignableEnvelope extends EnvelopeContext {
  type: MessageType;
  /** Running transcript hash of prior messages (RDV-12); null for the first message. */
  prevHash: Uint8Array | null;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
}

/**
 * Canonical bytes signed for a message — binds context + type + transcript chain +
 * ciphertext. Deliberately excludes the relay-assigned `seq`: message ordering is
 * authenticated by the prevHash transcript chain (RDV-12), not by the relay's cursor.
 */
export function messageSigningBytes(env: SignableEnvelope): Uint8Array {
  const canonical = [
    "randevu/msg/v1",
    env.sessionId,
    String(env.epoch),
    env.senderId,
    env.type,
    env.prevHash ? bytesToHex(env.prevHash) : "",
    bytesToHex(env.nonce),
    bytesToHex(env.ciphertext),
  ].join("|");
  return sha256(utf8ToBytes(canonical));
}

/** Sign a message envelope with the sender's Ed25519 identity key (non-repudiation). */
export function signMessage(env: SignableEnvelope, identityPrivateKey: Uint8Array): Uint8Array {
  return sign(messageSigningBytes(env), identityPrivateKey);
}

/** Verify a message envelope signature against the sender's identity public key. */
export function verifyMessage(
  env: SignableEnvelope,
  signature: Uint8Array,
  identityPublicKey: Uint8Array,
): boolean {
  return verify(signature, messageSigningBytes(env), identityPublicKey);
}

/**
 * Fold a message into the running transcript hash so the relay cannot reorder or
 * drop messages undetectably (RDV-12). Returns the new head hash.
 */
export function chainHash(prevHash: Uint8Array | null, signingBytes: Uint8Array): Uint8Array {
  return sha256(concatBytes(prevHash ?? new Uint8Array(0), signingBytes));
}
