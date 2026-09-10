import { describe, it, expect } from "vitest";
import { bytesToHex, concatBytes } from "@noble/hashes/utils";
import { base58 } from "@scure/base";
import { generateIdentityKeyPair, didKeyFromEd25519, ed25519FromDidKey } from "./index";

describe("did:key (ed25519)", () => {
  it("round-trips a public key through a did:key", () => {
    const { publicKey } = generateIdentityKeyPair();
    const did = didKeyFromEd25519(publicKey);
    expect(did.startsWith("did:key:z")).toBe(true);
    expect(bytesToHex(ed25519FromDidKey(did))).toBe(bytesToHex(publicKey));
  });

  it("rejects a string that is not a did:key", () => {
    expect(() => ed25519FromDidKey("https://example.com/x")).toThrow(/not a did:key/);
    expect(() => ed25519FromDidKey("did:web:example.com")).toThrow(/not a did:key/);
  });

  it("rejects a did:key that is not ed25519 (wrong multicodec)", () => {
    // Valid did:key shape + base58, but a 0x1200 multicodec instead of ed25519's 0xed01.
    const wrong = `did:key:z${base58.encode(
      concatBytes(Uint8Array.from([0x12, 0x00]), generateIdentityKeyPair().publicKey),
    )}`;
    expect(() => ed25519FromDidKey(wrong)).toThrow(/not an ed25519 did:key/);
  });
});
