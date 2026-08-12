import { randomBytes, bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { sha256 } from "@noble/hashes/sha256";
import { sealTo, openSealed } from "./sealedbox";
import { sign, verify, type AgreementKeyPair } from "./crypto";

/**
 * Generate a fresh 256-bit group key for an epoch. Every membership change bumps
 * the epoch and generates a new group key (see docs/ENCRYPTION.md).
 */
export function generateGroupKey(): Uint8Array {
  return randomBytes(32);
}

/** Commitment to a group key (hex SHA-256) — bound to the epoch by a signature. */
export function groupKeyCommitment(groupKey: Uint8Array): string {
  return bytesToHex(sha256(groupKey));
}

function groupKeyDistBytes(sessionId: string, epoch: number, commitment: string): Uint8Array {
  return sha256(utf8ToBytes(`randevu/groupkey/v1|${sessionId}|${epoch}|${commitment}`));
}

/**
 * The key-holder signs the group-key distribution for an epoch. Members verify this
 * against the holder's pinned identity key, so neither another member nor a malicious
 * relay can substitute a different group key (RDV-34).
 */
export function signGroupKey(
  sessionId: string,
  epoch: number,
  groupKey: Uint8Array,
  identityPrivateKey: Uint8Array,
): { commitment: string; signature: string } {
  const commitment = groupKeyCommitment(groupKey);
  const signature = bytesToHex(sign(groupKeyDistBytes(sessionId, epoch, commitment), identityPrivateKey));
  return { commitment, signature };
}

/** Verify an unwrapped group key matches a holder-signed commitment for the epoch. */
export function verifyGroupKey(
  sessionId: string,
  epoch: number,
  groupKey: Uint8Array,
  commitment: string,
  signatureHex: string,
  holderIdentityPub: Uint8Array,
): boolean {
  if (groupKeyCommitment(groupKey) !== commitment) return false;
  return verify(hexToBytes(signatureHex), groupKeyDistBytes(sessionId, epoch, commitment), holderIdentityPub);
}

/** Wrap (seal) the group key to a member's X25519 public key. Relay stays blind. */
export function wrapGroupKey(groupKey: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  return sealTo(recipientPublicKey, groupKey);
}

/** Unwrap a sealed group key with a member's X25519 keypair. */
export function unwrapGroupKey(wrapped: Uint8Array, recipient: AgreementKeyPair): Uint8Array {
  return openSealed(wrapped, recipient);
}
