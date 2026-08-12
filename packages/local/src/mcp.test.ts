import { describe, it, expect } from "vitest";
import { RandevuLocal, createMcpServer } from "./index";

describe("MCP server", () => {
  it("builds a server exposing connect()", () => {
    const local = new RandevuLocal({ relayUrl: "https://relay.example.com" });
    const server = createMcpServer(local);
    expect(typeof server.connect).toBe("function");
  });
});
