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

  it("carries no auth headers without a signer, and JSON content-type only on a body", async () => {
    let seen: Record<string, string> = {};
    const client = new RelayClient({
      baseUrl: "https://r",
      fetch: async (_u, init) => {
        seen = init?.headers ?? {};
        return { ok: true, status: 200, json: async () => ({ members: [] }) };
      },
    });
    await client.getMembers("rdv_x");
    expect(seen["x-randevu-member"]).toBeUndefined();
    expect(seen["content-type"]).toBeUndefined(); // GET, no body
  });

  it("signs each request over the path WITHOUT the query string", async () => {
    const canon: string[] = [];
    let headers: Record<string, string> = {};
    const client = new RelayClient({
      baseUrl: "https://r",
      signer: (c) => {
        canon.push(c);
        return { member: "MEID", signature: "SIG" };
      },
      fetch: async (_u, init) => {
        headers = init?.headers ?? {};
        return { ok: true, status: 200, json: async () => ({ messages: [], cursor: 0 }) };
      },
    });
    await client.getMessages("rdv_x", 5);
    expect(headers["x-randevu-member"]).toBe("MEID");
    expect(headers["x-randevu-auth"]).toBe("SIG");
    expect(headers["x-randevu-timestamp"]).toMatch(/^\d+$/);
    // canonical descriptor is over the bare path — the ?after=5 query is excluded
    expect(canon[0]).toContain("|/sessions/rdv_x/messages|");
    expect(canon[0]).not.toContain("after=5");
  });

  it("builds the right URL + method for each endpoint", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    const client = new RelayClient({
      baseUrl: "https://r",
      fetch: async (url, init) => {
        calls.push({ url, method: init?.method });
        return { ok: true, status: 200, json: async () => ({}) };
      },
    });
    const member = { fingerprint: "m", identityPub: "aa", kxPub: "bb" };
    await client.joinSession("rdv_x", { joinToken: "t", member });
    await client.postMessage("rdv_x", {
      epoch: 0, senderId: "m", ciphertext: "c", nonce: "n", signature: "s", type: "message", prevHash: null, ref: null,
    });
    await client.getMessages("rdv_x", 3);
    await client.postKeys("rdv_x", { senderId: "m", epoch: 1, keyCommitment: "kc", signature: "s", wraps: [] });
    await client.getKey("rdv_x", 1, "m");
    await client.status("rdv_x");
    await client.wait("rdv_x", 4, 25);
    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}${new URL(c.url).search}`)).toEqual([
      "POST /sessions/rdv_x/join",
      "POST /sessions/rdv_x/messages",
      "GET /sessions/rdv_x/messages?after=3",
      "POST /sessions/rdv_x/keys",
      "GET /sessions/rdv_x/keys?epoch=1&member=m",
      "GET /sessions/rdv_x/status",
      "GET /sessions/rdv_x/wait?after=4&timeout=25000",
    ]);
  });

  it("tolerates a non-JSON error body (falls back to relay_error)", async () => {
    const client = new RelayClient({
      baseUrl: "https://r",
      fetch: async () => ({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error("not json");
        },
      }),
    });
    await expect(client.status("rdv_x")).rejects.toMatchObject({ status: 500, code: "relay_error" });
  });
});
