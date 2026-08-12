import { base58 } from "@scure/base";
import { concatBytes } from "@noble/hashes/utils";

// Multicodec prefix for an Ed25519 public key: 0xed 0x01.
const ED25519_MULTICODEC = Uint8Array.from([0xed, 0x01]);
const DID_KEY_PREFIX = "did:key:z";

/**
 * Encode an Ed25519 public key as a `did:key` (RDV-29 interop seam).
 * Self-contained — the key is embedded, no resolution infrastructure needed.
 * Lets Randevu identities interoperate with ANP / W3C VC ecosystems.
 */
export function didKeyFromEd25519(publicKey: Uint8Array): string {
  const prefixed = concatBytes(ED25519_MULTICODEC, publicKey);
  return `${DID_KEY_PREFIX}${base58.encode(prefixed)}`;
}

/** Extract the Ed25519 public key from a `did:key`. Throws if not an ed25519 did:key. */
export function ed25519FromDidKey(did: string): Uint8Array {
  if (!did.startsWith(DID_KEY_PREFIX)) {
    throw new Error("not a did:key");
  }
  const decoded = base58.decode(did.slice(DID_KEY_PREFIX.length));
  if (decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error("not an ed25519 did:key");
  }
  return decoded.slice(2);
}
