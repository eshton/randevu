import { describe, it, expect } from "vitest";
import { RelayClient, RelayError, type FetchLike } from "./index";

const emptyOk: FetchLike = async () => ({ ok: true, status: 200, json: async () => ({}) });

describe("@randevu/relay-client", () => {
  it("normalizes the base URL and exposes a protocol version", () => {
    const client = new RelayClient({ baseUrl: "https://relay.example.com/", fetch: emptyOk });
    expect(client.endpoint).toBe("https://relay.example.com");
    expect(typeof client.protocolVersion).toBe("string");
  });

  it("createSession POSTs JSON to /sessions and returns the parsed body", async () => {
    let captured: { url: string; method?: string; body?: string } | undefined;
    const client = new RelayClient({
      baseUrl: "https://r",
      fetch: async (url, init) => {
        captured = { url, method: init?.method, body: init?.body };
        return { ok: true, status: 200, json: async () => ({ sessionId: "rdv_x", joinToken: "t", memberId: "m" }) };
      },
    });
    const res = await client.createSession({
      maxMembers: 2,
      creator: { fingerprint: "m", identityPub: "aa", kxPub: "bb" },
    });
    expect(captured?.url).toBe("https://r/sessions");
    expect(captured?.method).toBe("POST");
    expect(JSON.parse(captured!.body!)).toMatchObject({ maxMembers: 2 });
    expect(res.sessionId).toBe("rdv_x");
  });

  it("throws RelayError on a non-2xx response", async () => {
    const client = new RelayClient({
      baseUrl: "https://r",
      fetch: async () => ({ ok: false, status: 403, json: async () => ({ error: "invalid_join_token" }) }),
    });
    await expect(client.getMembers("rdv_x")).rejects.toBeInstanceOf(RelayError);
  });
});
