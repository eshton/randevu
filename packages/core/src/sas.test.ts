import { describe, it, expect } from "vitest";
import { generateIdentityKeyPair, computeSAS } from "./index";

describe("computeSAS (RDV-17)", () => {
  const sid = "rdv_x";
  const a = generateIdentityKeyPair().publicKey;
  const b = generateIdentityKeyPair().publicKey;
  const c = generateIdentityKeyPair().publicKey;

  it("is 6 digits and order-independent", () => {
    expect(computeSAS(sid, [a, b])).toMatch(/^\d{6}$/);
    expect(computeSAS(sid, [a, b])).toBe(computeSAS(sid, [b, a]));
  });

  it("differs for a different member set (substituted key)", () => {
    expect(computeSAS(sid, [a, b])).not.toBe(computeSAS(sid, [a, c]));
  });

  it("differs for a different session id", () => {
    expect(computeSAS("rdv_x", [a, b])).not.toBe(computeSAS("rdv_y", [a, b]));
  });
});
