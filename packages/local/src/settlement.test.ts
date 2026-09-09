import { describe, it, expect } from "vitest";
import {
  generateIdentityKeyPair,
  didKeyFromEd25519,
  ed25519FromDidKey,
  verifyCredential,
} from "@randevu/core";
import { issueCredential, issueMandate, x402PaymentRequired } from "./settlement";

function issuer() {
  const id = generateIdentityKeyPair();
  return { did: didKeyFromEd25519(id.publicKey), priv: id.privateKey };
}

describe("settlement artifacts", () => {
  it("issues a verifiable credential bound to the session", () => {
    const { did, priv } = issuer();
    const vc = issueCredential(did, priv, { accepted: "terms" }, "rdv_1");
    expect((vc["credentialSubject"] as { sessionId: string }).sessionId).toBe("rdv_1");
    expect(verifyCredential(vc, ed25519FromDidKey(vc["issuer"] as string))).toBe(true);
  });

  it("carries a null sessionId when there is no session", () => {
    const { did, priv } = issuer();
    const vc = issueCredential(did, priv, { accepted: "x" }, null);
    expect((vc["credentialSubject"] as { sessionId: string | null }).sessionId).toBeNull();
  });

  it("issues each AP2 mandate kind with the right type and a valid proof", () => {
    const { did, priv } = issuer();
    for (const [kind, type] of [
      ["intent", "IntentMandate"],
      ["cart", "CartMandate"],
      ["payment", "PaymentMandate"],
    ] as const) {
      const m = issueMandate(did, priv, kind, { amount: "100" }, "rdv_2");
      expect(m["type"]).toEqual(["VerifiableCredential", type]);
      expect(verifyCredential(m, ed25519FromDidKey(did))).toBe(true);
    }
  });

  it("builds an x402 payment-required descriptor", () => {
    const d = x402PaymentRequired({
      amount: "1000",
      asset: "USDC",
      network: "base",
      payTo: "0xabc",
      resource: "rdv://deal",
    });
    expect(d["x402Version"]).toBe(1);
    const accept = (d["accepts"] as Array<Record<string, unknown>>)[0]!;
    expect(accept["maxAmountRequired"]).toBe("1000");
    expect(accept["description"]).toBe("Randevu settled agreement"); // default
  });
});
