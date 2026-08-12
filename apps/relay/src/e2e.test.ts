import { describe, it, expect } from "vitest";
import { randomBytes, bytesToHex } from "@noble/hashes/utils";
import { Session } from "./session";
import { MemoryKvStore } from "./store";
import { dispatchSession } from "./dispatch";
import { RandevuLocal } from "@randevu/local";
import type { FetchLike } from "@randevu/relay-client";

/**
 * An in-process relay that reuses the REAL session logic + dispatch the Durable
 * Object uses, exposed as a FetchLike. Lets us drive two full RandevuLocal agents
 * end-to-end without the Workers runtime.
 */
function inMemoryRelay(): FetchLike {
  const sessions = new Map<string, Session>();
  return async (url, init) => {
    const u = new URL(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(init.body) : undefined;
    const segs = u.pathname.split("/").filter(Boolean);

    let result: { status: number; body: unknown };
    if (segs.length === 1 && segs[0] === "sessions" && method === "POST") {
      const sessionId = `rdv_${bytesToHex(randomBytes(16))}`;
      const session = new Session(new MemoryKvStore());
      sessions.set(sessionId, session);
      result = await dispatchSession(session, {
        sessionId,
        method: "POST",
        path: "/init",
        params: new URLSearchParams(),
        body,
      });
    } else if (segs[0] === "sessions" && segs.length >= 2) {
      const sessionId = segs[1]!;
      const session = sessions.get(sessionId);
      if (!session) {
        result = { status: 404, body: { error: "session_not_found" } };
      } else {
        const path = segs.length > 2 ? `/${segs.slice(2).join("/")}` : "/status";
        result = await dispatchSession(session, { sessionId, method, path, params: u.searchParams, body });
      }
    } else {
      result = { status: 404, body: { error: "not_found" } };
    }
    return { ok: result.status < 400, status: result.status, json: async () => result.body };
  };
}

describe("end-to-end negotiation through the blind relay", () => {
  it("two agents establish a session and exchange signed, encrypted messages", async () => {
    const fetch = inMemoryRelay();
    const alice = new RandevuLocal({ relayUrl: "https://relay", fetch });
    const bob = new RandevuLocal({ relayUrl: "https://relay", fetch });

    const { invite } = await alice.createSession(2);
    await bob.joinSession(invite); // includes anti-MITM fingerprint check

    await alice.establishGroupKey(); // creator is the key-holder
    await bob.syncGroupKey();

    await alice.send("Opening offer: 20000", "offer");
    const bobInbox = await bob.receive();
    expect(bobInbox).toHaveLength(1);
    expect(bobInbox[0]!.verified).toBe(true);
    expect(bobInbox[0]!.type).toBe("offer");
    expect(bobInbox[0]!.body).toBe("Opening offer: 20000");
    expect(bobInbox[0]!.senderId).toBe(alice.memberId);

    await bob.send("Counter: 17500", "counter");
    const aliceInbox = await alice.receive();
    expect(aliceInbox.map((m) => m.body)).toEqual(["Counter: 17500"]);
    expect(aliceInbox[0]!.verified).toBe(true);
    expect(aliceInbox[0]!.type).toBe("counter");
  });

  it("supports a three-party session", async () => {
    const fetch = inMemoryRelay();
    const client = new RandevuLocal({ relayUrl: "https://relay", fetch });
    const vendorA = new RandevuLocal({ relayUrl: "https://relay", fetch });
    const vendorB = new RandevuLocal({ relayUrl: "https://relay", fetch });

    const { invite } = await client.createSession(3);
    await vendorA.joinSession(invite);
    await vendorB.joinSession(invite);

    await client.establishGroupKey();
    await vendorA.syncGroupKey();
    await vendorB.syncGroupKey();

    await client.send("RFP: need 500 units");
    const a = await vendorA.receive();
    const b = await vendorB.receive();
    expect(a[0]!.body).toBe("RFP: need 500 units");
    expect(a[0]!.verified).toBe(true);
    expect(b[0]!.body).toBe("RFP: need 500 units");
    expect(b[0]!.verified).toBe(true);
  });

  it("the relay never sees plaintext (blind)", async () => {
    const base = inMemoryRelay();
    const seen: string[] = [];
    const fetch: FetchLike = async (url, init) => {
      if (init?.body) seen.push(init.body);
      return base(url, init);
    };
    const alice = new RandevuLocal({ relayUrl: "https://relay", fetch });
    const bob = new RandevuLocal({ relayUrl: "https://relay", fetch });

    const { invite } = await alice.createSession(2);
    await bob.joinSession(invite);
    await alice.establishGroupKey();
    await bob.syncGroupKey();

    const secret = "MERGER_PRICE_42M";
    await alice.send(secret);

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((payload) => payload.includes(secret))).toBe(false);
  });
});
