import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { RelayClient } from "@randevu/relay-client";
import {
  generateIdentityKeyPair,
  generateAgreementKeyPair,
  fingerprint,
  signRequest,
} from "@randevu/core";
import { bytesToHex } from "@noble/hashes/utils";
import { startNodeRelay, type NodeRelay } from "./node-relay";

/** A member with a request-signing RelayClient, mirroring what @randevu/local does. */
function makeMember() {
  const identity = generateIdentityKeyPair();
  const agreement = generateAgreementKeyPair();
  const fp = fingerprint(identity.publicKey);
  const dto = {
    fingerprint: fp,
    identityPub: bytesToHex(identity.publicKey),
    kxPub: bytesToHex(agreement.publicKey),
  };
  const client = (baseUrl: string) =>
    new RelayClient({
      baseUrl,
      signer: (canonical) => ({ member: fp, signature: signRequest(identity.privateKey, canonical) }),
    });
  return { fp, dto, client };
}

let relay: NodeRelay;
beforeAll(async () => {
  relay = await startNodeRelay(0);
});
afterAll(async () => {
  await relay.close();
});

describe("node relay", () => {
  it("serves a blind health check", async () => {
    const res = await fetch(`${relay.url}/`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ service: "randevu-relay", blind: true });
  });

  it("runs a full session end-to-end over HTTP", async () => {
    const a = makeMember();
    const b = makeMember();
    const ac = a.client(relay.url);

    const created = await ac.createSession({ maxMembers: 2, creator: a.dto });
    expect(created.sessionId).toMatch(/^rdv_[0-9a-f]{32}$/);

    const bc = b.client(relay.url);
    const joined = await bc.joinSession(created.sessionId, {
      joinToken: created.joinToken,
      member: b.dto,
    });
    expect(joined.members).toHaveLength(2);
    expect(joined.locked).toBe(true);

    const blob = {
      epoch: 1,
      senderId: a.fp,
      ciphertext: "aa",
      nonce: "bb",
      signature: "cc",
      type: "message",
      prevHash: null,
      ref: null,
    };
    // Serialized writes must hand back strictly monotonic seqs.
    const first = await ac.postMessage(created.sessionId, blob);
    const second = await ac.postMessage(created.sessionId, blob);
    expect([first.seq, second.seq]).toEqual([1, 2]);

    const got = await bc.getMessages(created.sessionId, 0);
    expect(got.messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(got.cursor).toBe(2);
  });

  it("rejects a member-only call without a signature", async () => {
    const a = makeMember();
    const created = await a.client(relay.url).createSession({ maxMembers: 2, creator: a.dto });
    // Raw fetch = no auth headers → 401 on a member-only path.
    const res = await fetch(`${relay.url}/sessions/${created.sessionId}/status`);
    expect(res.status).toBe(401);
  });

  it("404s an unknown session", async () => {
    const res = await fetch(`${relay.url}/sessions/rdv_deadbeef/status`);
    expect(res.status).toBe(404);
  });
});
