import { signCredential, type VerifiableCredential } from "@randevu/core";

/**
 * Payment / credential artifacts (RDV-29/31). Pure functions of an issuer identity +
 * input — no session state, no I/O — so they're unit-testable in isolation and don't
 * belong on the session object. RandevuLocal delegates its issue* methods here.
 */

/** AP2 mandate kind → its credential type name. */
const MANDATE_TYPE = { intent: "IntentMandate", cart: "CartMandate", payment: "PaymentMandate" } as const;
export type MandateKind = keyof typeof MANDATE_TYPE;

/**
 * Sign a W3C Verifiable Credential with the issuer's identity key — e.g. a portable
 * proof of acceptance. Verifiable via the issuer's did:key by any VC-JOSE / ANP / AP2 tool.
 */
export function issueCredential(
  did: string,
  identityPrivateKey: Uint8Array,
  credentialSubject: Record<string, unknown>,
  sessionId: string | null,
): VerifiableCredential {
  return signCredential(
    {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential", "RandevuAgreement"],
      issuer: did,
      credentialSubject: { ...credentialSubject, sessionId },
    },
    did,
    identityPrivateKey,
  );
}

/**
 * Emit a concluded deal as an AP2 payment Mandate (Intent / Cart / Payment) — a signed VC.
 * Randevu never touches funds; it produces the signed artifact a payment layer consumes.
 * Shape-compatible with AP2's three-mandate model; confirm field names before production.
 */
export function issueMandate(
  did: string,
  identityPrivateKey: Uint8Array,
  kind: MandateKind,
  subject: Record<string, unknown>,
  sessionId: string | null,
): VerifiableCredential {
  return signCredential(
    {
      "@context": ["https://www.w3.org/2018/credentials/v1", "https://ap2-protocol.org/context/v1"],
      type: ["VerifiableCredential", MANDATE_TYPE[kind]],
      issuer: did,
      credentialSubject: { ...subject, sessionId },
    },
    did,
    identityPrivateKey,
  );
}

export interface X402Input {
  amount: string;
  asset: string;
  network: string;
  payTo: string;
  resource: string;
  description?: string;
}

/**
 * Build an x402 "402 Payment Required" descriptor for a concluded deal (RDV-31). The
 * resource-server ask; the on-chain authorization is the payment rail's job. Shape-
 * compatible with x402; confirm against the current x402 spec before production.
 */
export function x402PaymentRequired(input: X402Input): Record<string, unknown> {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: input.network,
        maxAmountRequired: input.amount,
        asset: input.asset,
        payTo: input.payTo,
        resource: input.resource,
        description: input.description ?? "Randevu settled agreement",
      },
    ],
  };
}
