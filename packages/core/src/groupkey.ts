import { randomBytes } from "@noble/hashes/utils";
import { sealTo, openSealed } from "./sealedbox";
import type { AgreementKeyPair } from "./crypto";

/**
 * Generate a fresh 256-bit group key for an epoch. Every membership change bumps
 * the epoch and generates a new group key (see docs/ENCRYPTION.md).
 */
export function generateGroupKey(): Uint8Array {
  return randomBytes(32);
}

/** Wrap (seal) the group key to a member's X25519 public key. Relay stays blind. */
export function wrapGroupKey(groupKey: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
  return sealTo(recipientPublicKey, groupKey);
}

/** Unwrap a sealed group key with a member's X25519 keypair. */
export function unwrapGroupKey(wrapped: Uint8Array, recipient: AgreementKeyPair): Uint8Array {
  return openSealed(wrapped, recipient);
}
