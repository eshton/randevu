import { describe, it, expect } from "vitest";
import { randomBytes, bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { Session } from "./session";
import { MemoryKvStore } from "./store";
import { dispatchSession } from "./dispatch";
import { RandevuLocal } from "@randevu/local";
import { verifyTranscript, generateGroupKey, wrapGroupKey } from "@randevu/core";
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

  it("converges keys hands-off via status polling (MCP-style flow)", async () => {
    const fetch = inMemoryRelay();
    const alice = new RandevuLocal({ relayUrl: "https://relay", fetch });
    const bob = new RandevuLocal({ relayUrl: "https://relay", fetch });

    const { invite } = await alice.createSession(2);
    await bob.joinSession(invite);

    // No manual establish/sync — polling status converges the shared key.
    expect((await bob.getStatus()).hasKey).toBe(false); // creator hasn't posted the epoch key yet
    expect((await alice.getStatus()).hasKey).toBe(true); // creator posts on first status
    expect((await bob.getStatus()).hasKey).toBe(true); // member now unwraps it

    await alice.send("Deal?", "offer");
    const inbox = await bob.receive();
    expect(inbox[0]!.body).toBe("Deal?");
    expect(inbox[0]!.verified).toBe(true);
  });

  it("detects a reordered transcript (chain integrity, RDV-12)", async () => {
    // A malicious relay that reverses the message list on GET /messages.
    const base = inMemoryRelay();
    const fetch: FetchLike = async (url, init) => {
      const res = await base(url, init);
      const u = new URL(url);
      if (u.pathname.endsWith("/messages") && (init?.method ?? "GET") === "GET") {
        const body = (await res.json()) as { messages: unknown[] };
        if (Array.isArray(body.messages) && body.messages.length > 1) body.messages.reverse();
        return { ok: res.ok, status: res.status, json: async () => body };
      }
      return res;
    };

    const alice = new RandevuLocal({ relayUrl: "https://relay", fetch });
    const bob = new RandevuLocal({ relayUrl: "https://relay", fetch });
    const { invite } = await alice.createSession(2);
    await bob.joinSession(invite);
    await alice.getStatus();
    await bob.getStatus();

    await alice.send("first", "offer");
    await alice.send("second", "counter");

    const inbox = await bob.receive();
    // Reordered delivery breaks the transcript chain → flagged unverified.
    expect(inbox.some((m) => !m.verified)).toBe(true);
  });

  it("exports a transcript that verifies offline (RDV-15)", async () => {
    const fetch = inMemoryRelay();
    const alice = new RandevuLocal({ relayUrl: "https://relay", fetch });
    const bob = new RandevuLocal({ relayUrl: "https://relay", fetch });
    const { invite } = await alice.createSession(2);
    await bob.joinSession(invite);
    await alice.getStatus();
    await bob.getStatus();

    await alice.send("Offer 100", "offer");
    await bob.send("Accept", "accept");

    const bundle = await alice.exportTranscript();
    const verdict = verifyTranscript(bundle); // pure, no network, no private keys

    expect(verdict.valid).toBe(true);
    expect(verdict.membersValid).toBe(true);
    expect(verdict.messages.map((m) => m.body)).toEqual(["Offer 100", "Accept"]);
    expect(verdict.messages.map((m) => m.senderId)).toEqual([alice.memberId, bob.memberId]);
  });

  it("binds an acceptance to specific terms (RDV-14 agreements)", async () => {
    const fetch = inMemoryRelay();
    const alice = new RandevuLocal({ relayUrl: "https://relay", fetch });
    const bob = new RandevuLocal({ relayUrl: "https://relay", fetch });
    const { invite } = await alice.createSession(2);
    await bob.joinSession(invite);
    await alice.getStatus();
    await bob.getStatus();

    // Alice offers; Bob reads the offer's content-id and accepts exactly those terms.
    await alice.offer("Price 18000, delivery in 30 days");
    const [offerMsg] = await bob.receive();
    await bob.accept(offerMsg!.id, "agreed");

    const bundle = await alice.exportTranscript();
    const verdict = verifyTranscript(bundle);

    expect(verdict.valid).toBe(true);
    expect(verdict.agreements).toHaveLength(1);
    expect(verdict.agreements[0]!.accepter).toBe(bob.memberId);
    expect(verdict.agreements[0]!.acceptedSenderId).toBe(alice.memberId);
    expect(verdict.agreements[0]!.acceptedBody).toBe("Price 18000, delivery in 30 days");
  });

  it("rejects a group key substituted by a malicious relay (RDV-34)", async () => {
    // A relay that swaps in its OWN group key (sealed to the member's real pubkey),
    // keeping the holder's original commitment+signature (which it cannot forge).
    const base = inMemoryRelay();
    const kxByFingerprint = new Map<string, string>();
    const fetch: FetchLike = async (url, init) => {
      const body = init?.body ? JSON.parse(init.body) : undefined;
      if (body?.creator?.kxPub) kxByFingerprint.set(body.creator.fingerprint, body.creator.kxPub);
      if (body?.member?.kxPub) kxByFingerprint.set(body.member.fingerprint, body.member.kxPub);

      const res = await base(url, init);
      const u = new URL(url);
      if (u.pathname.endsWith("/keys") && (init?.method ?? "GET") === "GET") {
        const member = u.searchParams.get("member") ?? "";
        const kx = kxByFingerprint.get(member);
        const orig = (await res.json()) as { wrappedKey?: string };
        if (kx && orig.wrappedKey) {
          orig.wrappedKey = bytesToHex(wrapGroupKey(generateGroupKey(), hexToBytes(kx)));
          return { ok: res.ok, status: res.status, json: async () => orig };
        }
        return { ok: res.ok, status: res.status, json: async () => orig };
      }
      return res;
    };

    const alice = new RandevuLocal({ relayUrl: "https://relay", fetch });
    const bob = new RandevuLocal({ relayUrl: "https://relay", fetch });
    const { invite } = await alice.createSession(2);
    await bob.joinSession(invite);
    await alice.getStatus(); // creator posts the signed group key

    // Bob receives a substituted key → holder-signature verification fails, loudly.
    await expect(bob.getStatus()).rejects.toThrow(/holder verification/);
  });

  it("SAS matches for both honest parties (RDV-17)", async () => {
    const fetch = inMemoryRelay();
    const alice = new RandevuLocal({ relayUrl: "https://relay", fetch });
    const bob = new RandevuLocal({ relayUrl: "https://relay", fetch });
    const { invite } = await alice.createSession(2);
    await bob.joinSession(invite);
    expect((await alice.getSAS()).sas).toBe((await bob.getSAS()).sas);
  });

  it("SAS diverges when the relay substitutes a member's identity key (RDV-17)", async () => {
    const base = inMemoryRelay();
    let targetFp = "";
    const fetch: FetchLike = async (url, init) => {
      const res = await base(url, init);
      const u = new URL(url);
      if (u.pathname.endsWith("/status") && (init?.method ?? "GET") === "GET") {
        const body = (await res.json()) as { members?: { fingerprint: string; identityPub: string }[] };
        for (const m of body.members ?? []) {
          if (m.fingerprint === targetFp) m.identityPub = bytesToHex(randomBytes(32));
        }
        return { ok: res.ok, status: res.status, json: async () => body };
      }
      return res;
    };

    const alice = new RandevuLocal({ relayUrl: "https://relay", fetch });
    const bob = new RandevuLocal({ relayUrl: "https://relay", fetch });
    const { invite } = await alice.createSession(2);
    await bob.joinSession(invite);
    targetFp = bob.memberId; // relay lies about Bob's identity key in status views

    // Alice sees the fake key, Bob uses his own real one → SAS mismatch (detected out-of-band).
    expect((await alice.getSAS()).sas).not.toBe((await bob.getSAS()).sas);
  });
});
