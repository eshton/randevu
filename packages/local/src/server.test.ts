import { describe, it, expect } from "vitest";
import { createRandevuServer, LOCAL_VERSION } from "./index";

describe("@randevu/local", () => {
  it("exposes a version", () => {
    expect(typeof LOCAL_VERSION).toBe("string");
  });

  it("wires a server with an identity and relay", () => {
    const server = createRandevuServer({ relayUrl: "https://relay.example.com" });
    expect(server.name).toBe("randevu-local");
    expect(server.memberId).toMatch(/^[0-9a-f]{32}$/);
    expect(server.relay.endpoint).toBe("https://relay.example.com");
  });
});
