import { hexToBytes, bytesToHex } from "@noble/hashes/utils";
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
  ref: string | null;
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
  /** Content-id (hex of canonical signing bytes) — stable reference target. */
  id: string;
  senderId: string;
  type: MessageType;
  /** Content-id of the message this one references (e.g. an accept's offer); null if none. */
  ref: string | null;
  /** Decrypted plaintext, or null if it could not be verified/decrypted. */
  body: string | null;
  signatureValid: boolean;
  chainValid: boolean;
}

/** A resolved acceptance: who signed off on which terms. The core non-repudiation payoff. */
export interface Agreement {
  accepter: string;
  acceptsId: string;
  acceptedSenderId: string | null;
  acceptedBody: string | null;
}

export interface TranscriptVerification {
  /** True only if members, every signature, every chain link, and every decryption check out. */
  valid: boolean;
  membersValid: boolean;
  messages: VerifiedTranscriptMessage[];
  /** Signed acceptances, each bound to the exact terms it accepted. */
  agreements: Agreement[];
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
  const byId = new Map<string, VerifiedTranscriptMessage>();

  for (const m of ordered) {
    const env: SignableEnvelope = {
      sessionId: bundle.sessionId,
      epoch: m.epoch,
      senderId: m.senderId,
      type: m.type,
      prevHash: m.prevHash ? hexToBytes(m.prevHash) : null,
      ref: m.ref,
      nonce: hexToBytes(m.nonce),
      ciphertext: hexToBytes(m.ciphertext),
    };
    const signingBytes = messageSigningBytes(env);
    const id = bytesToHex(signingBytes);
    const pub = idByFingerprint.get(m.senderId);
    const signatureValid = pub ? verifyMessage(env, hexToBytes(m.signature), pub) : false;
    const chainValid = bytesEqualNullable(env.prevHash, head);
    head = chainHash(head, signingBytes);

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
    const vm: VerifiedTranscriptMessage = {
      seq: m.seq,
      id,
      senderId: m.senderId,
      type: m.type,
      ref: m.ref,
      body,
      signatureValid,
      chainValid,
    };
    messages.push(vm);
    byId.set(id, vm);
  }

  const agreements: Agreement[] = messages
    .filter((m) => m.type === "accept" && m.ref && m.signatureValid && m.chainValid)
    .map((m) => {
      const accepted = byId.get(m.ref as string);
      return {
        accepter: m.senderId,
        acceptsId: m.ref as string,
        acceptedSenderId: accepted?.senderId ?? null,
        acceptedBody: accepted?.body ?? null,
      };
    });

  return { valid, membersValid, messages, agreements };
}
