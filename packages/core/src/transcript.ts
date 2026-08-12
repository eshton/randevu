import { hexToBytes } from "@noble/hashes/utils";
import {
  verifyMessage,
  messageSigningBytes,
  chainHash,
  decryptMessage,
  type MessageType,
  type SignableEnvelope,
} from "./message";
import { fingerprint } from "./crypto";
import { didKeyFromEd25519 } from "./did";

export interface TranscriptMember {
  fingerprint: string;
  did: string;
  /** Ed25519 identity public key (hex). */
  identityPub: string;
}

export interface TranscriptMessageEntry {
  seq: number;
  epoch: number;
  senderId: string;
  type: MessageType;
  nonce: string;
  ciphertext: string;
  prevHash: string | null;
  signature: string;
}

/**
 * A self-contained, portable proof of a session. The group keys are deliberately
 * disclosed here (the parties choose to reveal them to an arbiter) so a verifier
 * can decrypt and check content offline. The relay never had these keys.
 */
export interface TranscriptBundle {
  version: "randevu-transcript/v1";
  sessionId: string;
  members: TranscriptMember[];
  groupKeys: { epoch: number; key: string }[];
  messages: TranscriptMessageEntry[];
}

export interface VerifiedTranscriptMessage {
  seq: number;
  senderId: string;
  type: MessageType;
  /** Decrypted plaintext, or null if it could not be verified/decrypted. */
  body: string | null;
  signatureValid: boolean;
  chainValid: boolean;
}

export interface TranscriptVerification {
  /** True only if members, every signature, every chain link, and every decryption check out. */
  valid: boolean;
  membersValid: boolean;
  messages: VerifiedTranscriptMessage[];
}

function bytesEqualNullable(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Verify a transcript bundle offline — no network, no private keys. Checks that
 * each member's fingerprint/did matches its public key, every message signature
 * verifies against the pinned identity key, the prevHash chain is continuous
 * (no reorder/drop/insert), and each ciphertext decrypts under the disclosed
 * group key. This is the non-repudiation proof: who signed exactly what, in order.
 */
export function verifyTranscript(bundle: TranscriptBundle): TranscriptVerification {
  const idByFingerprint = new Map<string, Uint8Array>();
  let membersValid = true;
  for (const m of bundle.members) {
    const pub = hexToBytes(m.identityPub);
    idByFingerprint.set(m.fingerprint, pub);
    if (fingerprint(pub) !== m.fingerprint || didKeyFromEd25519(pub) !== m.did) {
      membersValid = false;
    }
  }

  const keyByEpoch = new Map<number, Uint8Array>();
  for (const g of bundle.groupKeys) keyByEpoch.set(g.epoch, hexToBytes(g.key));

  const ordered = [...bundle.messages].sort((a, b) => a.seq - b.seq);
  let head: Uint8Array | null = null;
  let valid = membersValid;
  const messages: VerifiedTranscriptMessage[] = [];

  for (const m of ordered) {
    const env: SignableEnvelope = {
      sessionId: bundle.sessionId,
      epoch: m.epoch,
      senderId: m.senderId,
      type: m.type,
      prevHash: m.prevHash ? hexToBytes(m.prevHash) : null,
      nonce: hexToBytes(m.nonce),
      ciphertext: hexToBytes(m.ciphertext),
    };
    const pub = idByFingerprint.get(m.senderId);
    const signatureValid = pub ? verifyMessage(env, hexToBytes(m.signature), pub) : false;
    const chainValid = bytesEqualNullable(env.prevHash, head);
    head = chainHash(head, messageSigningBytes(env));

    let body: string | null = null;
    const gk = keyByEpoch.get(m.epoch);
    if (signatureValid && gk) {
      try {
        body = decryptMessage(
          gk,
          { sessionId: bundle.sessionId, epoch: m.epoch, senderId: m.senderId },
          { nonce: env.nonce, ciphertext: env.ciphertext },
        );
      } catch {
        body = null;
      }
    }

    if (!signatureValid || !chainValid || body === null) valid = false;
    messages.push({ seq: m.seq, senderId: m.senderId, type: m.type, body, signatureValid, chainValid });
  }

  return { valid, membersValid, messages };
}
