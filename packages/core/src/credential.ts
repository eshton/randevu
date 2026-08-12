import { base64urlnopad } from "@scure/base";
import { utf8ToBytes } from "@noble/hashes/utils";
import { bytesToUtf8 } from "@noble/ciphers/utils";
import { sign, verify } from "./crypto";

/**
 * A minimal W3C Verifiable Credential with an EdDSA JWS proof (RDV-29 interop seam).
 * Lets a member issue a standards-shaped, signed credential (e.g. "I accept these terms")
 * that ANP / AP2 / VC-JOSE tooling can consume. Ed25519 = EdDSA keeps this standard.
 */
export type VerifiableCredential = Record<string, unknown> & { proof?: unknown };

/** JSON Canonicalization (sorted keys) so signer and verifier hash identical bytes. */
function jcs(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(jcs).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jcs(obj[k])}`)
    .join(",")}}`;
}

/** Sign a credential document with the issuer's Ed25519 identity key. Adds a `proof`. */
export function signCredential(
  credential: Record<string, unknown>,
  issuerDid: string,
  identityPrivateKey: Uint8Array,
): VerifiableCredential {
  const headerB64 = base64urlnopad.encode(utf8ToBytes(JSON.stringify({ alg: "EdDSA", kid: issuerDid })));
  const payloadB64 = base64urlnopad.encode(utf8ToBytes(jcs(credential)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const jws = `${signingInput}.${base64urlnopad.encode(sign(utf8ToBytes(signingInput), identityPrivateKey))}`;
  return {
    ...credential,
    proof: {
      type: "JsonWebSignature2020",
      verificationMethod: issuerDid,
      proofPurpose: "assertionMethod",
      jws,
    },
  };
}

/** Verify a credential's JWS proof against the issuer's identity public key. */
export function verifyCredential(vc: VerifiableCredential, issuerPublicKey: Uint8Array): boolean {
  const proof = vc.proof as { jws?: string } | undefined;
  if (!proof?.jws) return false;
  const parts = proof.jws.split(".");
  if (parts.length !== 3) return false;
  const [h, p, s] = parts as [string, string, string];

  const credential: Record<string, unknown> = { ...vc };
  delete credential["proof"];
  if (bytesToUtf8(base64urlnopad.decode(p)) !== jcs(credential)) return false;

  return verify(base64urlnopad.decode(s), utf8ToBytes(`${h}.${p}`), issuerPublicKey);
}
