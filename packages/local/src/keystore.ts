import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { scrypt } from "@noble/hashes/scrypt";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes, bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";
import { bytesToUtf8 } from "@noble/ciphers/utils";
import {
  generateIdentityKeyPair,
  generateAgreementKeyPair,
  identityKeyPairFromPrivate,
  agreementKeyPairFromPrivate,
  type IdentityKeyPair,
  type AgreementKeyPair,
} from "@randevu/core";

export interface RandevuKeys {
  identity: IdentityKeyPair;
  agreement: AgreementKeyPair;
}

export interface KeystoreFile {
  v: 1;
  salt: string;
  nonce: string;
  ciphertext: string;
}

// Deliberately expensive KDF so a stolen keystore file resists offline guessing.
const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1, dkLen: 32 } as const;

function deriveKey(passphrase: string, salt: Uint8Array): Uint8Array {
  return scrypt(utf8ToBytes(passphrase), salt, SCRYPT_PARAMS);
}

/** Encrypt a keypair set under a passphrase (scrypt → XChaCha20-Poly1305). */
export function encodeKeystore(keys: RandevuKeys, passphrase: string): KeystoreFile {
  const salt = randomBytes(16);
  const nonce = randomBytes(24);
  const key = deriveKey(passphrase, salt);
  const payload = utf8ToBytes(
    JSON.stringify({
      identity: bytesToHex(keys.identity.privateKey),
      agreement: bytesToHex(keys.agreement.privateKey),
    }),
  );
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(payload);
  return { v: 1, salt: bytesToHex(salt), nonce: bytesToHex(nonce), ciphertext: bytesToHex(ciphertext) };
}

/** Decrypt a keystore file. Throws on a wrong passphrase (AEAD tag failure). */
export function decodeKeystore(file: KeystoreFile, passphrase: string): RandevuKeys {
  const key = deriveKey(passphrase, hexToBytes(file.salt));
  const plaintext = xchacha20poly1305(key, hexToBytes(file.nonce)).decrypt(hexToBytes(file.ciphertext));
  const parsed = JSON.parse(bytesToUtf8(plaintext)) as { identity: string; agreement: string };
  return {
    identity: identityKeyPairFromPrivate(hexToBytes(parsed.identity)),
    agreement: agreementKeyPairFromPrivate(hexToBytes(parsed.agreement)),
  };
}

/**
 * Load keys from an encrypted keystore file, or generate + persist a new one
 * (mode 0600) if it doesn't exist. This is what gives a member a stable identity
 * across restarts (RDV-8).
 */
export function loadOrCreateKeystore(path: string, passphrase: string): RandevuKeys {
  if (existsSync(path)) {
    const file = JSON.parse(readFileSync(path, "utf8")) as KeystoreFile;
    return decodeKeystore(file, passphrase);
  }
  const keys: RandevuKeys = {
    identity: generateIdentityKeyPair(),
    agreement: generateAgreementKeyPair(),
  };
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(encodeKeystore(keys, passphrase), null, 2)}\n`, { mode: 0o600 });
  return keys;
}
