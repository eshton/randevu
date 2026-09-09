import { hexToBytes, bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import {
  verifyMessage,
  messageSigningBytes,
  chainHash,
  decryptMessage,
  type MessageType,
  type SignableEnvelope,
} from "./message";
import { fingerprint, sign, verify } from "./crypto";
import { didKeyFromEd25519 } from "./did";

/**
 * Signed commitment to the transcript's final state. Without it the hash chain proves no
 * reorder/drop/insert *within* the presented messages, but a relay could still drop the
 * tail and present a shorter valid chain. Signing (lastSeq, headHash) lets a verifier
 * detect that truncation: fewer messages than lastSeq, or a different head, fails.
 */
export interface TranscriptHead {
  lastSeq: number;
  /** Hex of the running chain head after the last message (empty string if no messages). */
  headHash: string;
  /** Fingerprint of the member who signed this head. */
  signer: string;
  signature: string;
}

/** Canonical bytes signed for a transcript head. */
export function transcriptHeadCanonical(sessionId: string, lastSeq: number, headHash: string): string {
  return `randevu/transcript-head/v1|${sessionId}|${lastSeq}|${headHash}`;
}

/** Sign a transcript head with a member's Ed25519 identity key. */
export function signTranscriptHead(
  sessionId: string,
  lastSeq: number,
  headHash: string,
  signer: string,
  identityPrivateKey: Uint8Array,
): TranscriptHead {
  const signature = bytesToHex(sign(utf8ToBytes(transcriptHeadCanonical(sessionId, lastSeq, headHash)), identityPrivateKey));
  return { lastSeq, headHash, signer, signature };
}

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
  /** Optional signed commitment to the final (lastSeq, headHash) — detects tail truncation. */
  head?: TranscriptHead;
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
  /**
   * Signed-head check: true if a valid head is present and matches (lastSeq + headHash);
   * false if a head is present but fails (bad signature, or truncated/altered tail);
   * undefined if the bundle carries no head (older exports — nothing to check).
   */
  headValid?: boolean;
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
  // An offline verifier is fed adversarial/corrupt bundles by design — malformed hex or
  // a missing field must yield valid:false, never an uncaught throw. Guard every decode.
  const members = Array.isArray(bundle.members) ? bundle.members : [];
  const idByFingerprint = new Map<string, Uint8Array>();
  let membersValid = members.length > 0;
  for (const m of members) {
    try {
      const pub = hexToBytes(m.identityPub);
      idByFingerprint.set(m.fingerprint, pub);
      if (fingerprint(pub) !== m.fingerprint || didKeyFromEd25519(pub) !== m.did) {
        membersValid = false;
      }
    } catch {
      membersValid = false;
    }
  }

  const keyByEpoch = new Map<number, Uint8Array>();
  for (const g of Array.isArray(bundle.groupKeys) ? bundle.groupKeys : []) {
    try {
      keyByEpoch.set(g.epoch, hexToBytes(g.key));
    } catch {
      // skip a corrupt disclosed key; messages in that epoch then fail to decrypt (invalid)
    }
  }

  const ordered = [...(Array.isArray(bundle.messages) ? bundle.messages : [])].sort((a, b) => a.seq - b.seq);
  let head: Uint8Array | null = null;
  let valid = membersValid;
  const messages: VerifiedTranscriptMessage[] = [];
  const byId = new Map<string, VerifiedTranscriptMessage>();

  for (const m of ordered) {
    let env: SignableEnvelope;
    try {
      env = {
        sessionId: bundle.sessionId,
        epoch: m.epoch,
        senderId: m.senderId,
        type: m.type,
        prevHash: m.prevHash ? hexToBytes(m.prevHash) : null,
        ref: m.ref,
        nonce: hexToBytes(m.nonce),
        ciphertext: hexToBytes(m.ciphertext),
      };
    } catch {
      // A message with undecodable hex can't be placed in the chain — bundle is invalid.
      valid = false;
      messages.push({
        seq: m.seq,
        id: "",
        senderId: m.senderId,
        type: m.type,
        ref: m.ref,
        body: null,
        signatureValid: false,
        chainValid: false,
      });
      continue;
    }
    const signingBytes = messageSigningBytes(env);
    const id = bytesToHex(signingBytes);
    const pub = idByFingerprint.get(m.senderId);
    let signatureValid = false;
    try {
      signatureValid = pub ? verifyMessage(env, hexToBytes(m.signature), pub) : false;
    } catch {
      signatureValid = false;
    }
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

  // Signed head: detect tail truncation. Verify the signature against the signer's pinned
  // key and that the committed (lastSeq, headHash) matches what we actually folded.
  let headValid: boolean | undefined;
  if (bundle.head) {
    const h = bundle.head;
    const computedHead = head ? bytesToHex(head) : "";
    const lastSeq = ordered.length ? ordered[ordered.length - 1]!.seq : 0;
    const signerPub = idByFingerprint.get(h.signer);
    let sigOk = false;
    try {
      sigOk = signerPub
        ? verify(
            hexToBytes(h.signature),
            utf8ToBytes(transcriptHeadCanonical(bundle.sessionId, h.lastSeq, h.headHash)),
            signerPub,
          )
        : false;
    } catch {
      sigOk = false;
    }
    headValid = sigOk && h.headHash === computedHead && h.lastSeq === lastSeq;
    if (!headValid) valid = false;
  }

  return { valid, membersValid, messages, agreements, ...(headValid !== undefined ? { headValid } : {}) };
}
