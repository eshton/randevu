import { describe, it, expect } from "vitest";
import { RelayClient } from "./index";

describe("@randevu/relay-client", () => {
  it("normalizes the base URL", () => {
    const client = new RelayClient({ baseUrl: "https://relay.example.com/" });
    expect(client.endpoint).toBe("https://relay.example.com");
  });

  it("exposes a protocol version from core", () => {
    const client = new RelayClient({ baseUrl: "https://relay.example.com" });
    expect(typeof client.protocolVersion).toBe("string");
  });

  it("createSession is not implemented yet (RDV-3)", async () => {
    const client = new RelayClient({ baseUrl: "https://relay.example.com" });
    await expect(client.createSession({ maxMembers: 2 })).rejects.toThrow("RDV-3");
  });
});
