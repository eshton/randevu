import { sha256 } from "@noble/hashes/sha256";
import { utf8ToBytes, bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { sign, verify } from "./crypto";

/**
 * Request authentication (RDV-32). A member signs a canonical descriptor of each
 * request so the relay can authenticate the caller and reject non-members. This is
 * anti-spam / anti-abuse at the relay edge — orthogonal to E2E, which holds regardless.
 */
export function requestCanonical(method: string, fullPath: string, timestamp: string): string {
  return `randevu/req/v1|${method}|${fullPath}|${timestamp}`;
}

function requestAuthBytes(canonical: string): Uint8Array {
  return sha256(utf8ToBytes(canonical));
}

/** Sign a canonical request descriptor with the member's Ed25519 identity key. */
export function signRequest(identityPrivateKey: Uint8Array, canonical: string): string {
  return bytesToHex(sign(requestAuthBytes(canonical), identityPrivateKey));
}

/** Verify a request signature against a member's identity public key. */
export function verifyRequest(
  identityPublicKey: Uint8Array,
  canonical: string,
  signatureHex: string,
): boolean {
  return verify(hexToBytes(signatureHex), requestAuthBytes(canonical), identityPublicKey);
}
