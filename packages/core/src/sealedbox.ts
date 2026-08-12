import { x25519 } from "@noble/curves/ed25519";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { blake2b } from "@noble/hashes/blake2b";
import { concatBytes, utf8ToBytes } from "@noble/hashes/utils";
import { generateAgreementKeyPair, type AgreementKeyPair } from "./crypto";

const SEAL_INFO = utf8ToBytes("randevu/sealedbox/v1");

function deriveSealKey(
  shared: Uint8Array,
  ephemeralPub: Uint8Array,
  recipientPub: Uint8Array,
): Uint8Array {
  // Salt binds both public keys; info domain-separates this use of the shared secret.
  const salt = concatBytes(ephemeralPub, recipientPub);
  return hkdf(sha256, shared, salt, SEAL_INFO, 32);
}

function sealNonce(ephemeralPub: Uint8Array, recipientPub: Uint8Array): Uint8Array {
  // Deterministic 24-byte nonce (unique per ephemeral key), libsodium-seal style.
  return blake2b(concatBytes(ephemeralPub, recipientPub), { dkLen: 24 });
}

/**
 * Anonymous encrypt-to-public-key (a libsodium `crypto_box_seal` analog).
 * The recipient cannot identify the sender. Output: ephemeralPublicKey(32) || ciphertext.
 * Used to wrap the group key to each member (RDV-10).
 */
export function sealTo(recipientPublicKey: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const ephemeral: AgreementKeyPair = generateAgreementKeyPair();
  const shared = x25519.getSharedSecret(ephemeral.privateKey, recipientPublicKey);
  const key = deriveSealKey(shared, ephemeral.publicKey, recipientPublicKey);
  const nonce = sealNonce(ephemeral.publicKey, recipientPublicKey);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(plaintext);
  return concatBytes(ephemeral.publicKey, ciphertext);
}

/** Open a sealed box with the recipient's X25519 keypair. Throws on tag failure. */
export function openSealed(sealed: Uint8Array, recipient: AgreementKeyPair): Uint8Array {
  const ephemeralPub = sealed.slice(0, 32);
  const ciphertext = sealed.slice(32);
  const shared = x25519.getSharedSecret(recipient.privateKey, ephemeralPub);
  const key = deriveSealKey(shared, ephemeralPub, recipient.publicKey);
  const nonce = sealNonce(ephemeralPub, recipient.publicKey);
  return xchacha20poly1305(key, nonce).decrypt(ciphertext);
}
