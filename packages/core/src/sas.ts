import { sha256 } from "@noble/hashes/sha256";
import { concatBytes, utf8ToBytes } from "@noble/hashes/utils";

function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = a[i]! - b[i]!;
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

/**
 * Short Authentication String (RDV-17). Both parties compute this from the session id
 * and ALL members' identity public keys (order-independent), then compare it out-of-band.
 * If the codes match, no member's key was substituted by the relay or a peer — closing the
 * gap that the invite fingerprint only covers the creator. A mismatch means someone's key
 * differs between the two views: abort.
 */
export function computeSAS(sessionId: string, identityPublicKeys: Uint8Array[], digits = 6): string {
  const sorted = [...identityPublicKeys].sort(compareBytes);
  const h = sha256(concatBytes(utf8ToBytes(`randevu/sas/v1|${sessionId}`), ...sorted));
  const val = ((h[0]! << 24) | (h[1]! << 16) | (h[2]! << 8) | h[3]!) >>> 0;
  return String(val % 10 ** digits).padStart(digits, "0");
}
