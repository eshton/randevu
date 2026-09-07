import { describe, it, expect } from "vitest";
import { encodeInvite, parseInvite, encodeJoinLink, parseJoinLink } from "./invite";

const invite = { sessionId: "rdv_abc123", fingerprint: "9c1f", joinToken: "2b7e" };

describe("join link", () => {
  it("round-trips through a link", () => {
    const link = encodeJoinLink("https://relay.randevu.dev", invite);
    expect(link).toBe("https://relay.randevu.dev/j/rdv_abc123#9c1f.2b7e");
    const parsed = parseJoinLink(link);
    expect(parsed.relayUrl).toBe("https://relay.randevu.dev");
    expect(parsed.invite).toEqual(invite);
  });

  it("preserves a custom relay host + port (self-hosted / tunnel)", () => {
    const link = encodeJoinLink("http://127.0.0.1:8787", invite);
    const parsed = parseJoinLink(link);
    expect(parsed.relayUrl).toBe("http://127.0.0.1:8787");
    expect(parsed.invite).toEqual(invite);
  });

  it("rejects malformed links", () => {
    expect(() => parseJoinLink("not a url")).toThrow();
    expect(() => parseJoinLink("https://x/y/z")).toThrow();
    expect(() => parseJoinLink("https://x/j/rdv_1")).toThrow(); // no fragment
    expect(() => parseJoinLink("https://x/j/rdv_1#nodot")).toThrow();
  });

  it("leaves the bare invite string working", () => {
    expect(parseInvite(encodeInvite(invite))).toEqual(invite);
  });
});
