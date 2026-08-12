import { ed25519, x25519 } from "@noble/curves/ed25519";
import { blake2b } from "@noble/hashes/blake2b";
import { bytesToHex } from "@noble/hashes/utils";

/**
 * Ed25519 identity keypair — signs messages (authenticity + non-repudiation).
 * The fingerprint of `publicKey` IS the member identity.
 */
export interface IdentityKeyPair {
  /** Ed25519 private seed (32 bytes). Never leaves the machine. */
  privateKey: Uint8Array;
  /** Ed25519 public key (32 bytes). */
  publicKey: Uint8Array;
}

/**
 * X25519 key-agreement keypair — receives the wrapped group key (RDV-10).
 */
export interface AgreementKeyPair {
  /** X25519 private key (32 bytes). Never leaves the machine. */
  privateKey: Uint8Array;
  /** X25519 public key (32 bytes). */
  publicKey: Uint8Array;
}

/** Generate an Ed25519 identity keypair (signing / non-repudiation). */
export function generateIdentityKeyPair(): IdentityKeyPair {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

/** Generate an X25519 key-agreement keypair (group-key wrapping). */
export function generateAgreementKeyPair(): AgreementKeyPair {
  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

/** Reconstruct an Ed25519 identity keypair from its stored private key. */
export function identityKeyPairFromPrivate(privateKey: Uint8Array): IdentityKeyPair {
  return { privateKey, publicKey: ed25519.getPublicKey(privateKey) };
}

/** Reconstruct an X25519 agreement keypair from its stored private key. */
export function agreementKeyPairFromPrivate(privateKey: Uint8Array): AgreementKeyPair {
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

/** Sign a message with an Ed25519 identity private key. */
export function sign(message: Uint8Array, privateKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, privateKey);
}

/** Verify an Ed25519 signature against an identity public key. */
export function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  return ed25519.verify(signature, message, publicKey);
}

/**
 * Member fingerprint — truncated BLAKE2b of the identity public key.
 * Committed in the invite for anti-MITM (see docs/ENCRYPTION.md).
 */
export function fingerprint(identityPublicKey: Uint8Array, bytes = 16): string {
  return bytesToHex(blake2b(identityPublicKey, { dkLen: bytes }));
}
