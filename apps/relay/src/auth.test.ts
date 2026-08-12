import { describe, it, expect } from "vitest";
import { bytesToHex } from "@noble/hashes/utils";
import {
  generateIdentityKeyPair,
  generateAgreementKeyPair,
  fingerprint,
  signRequest,
  requestCanonical,
} from "@randevu/core";
import { Session } from "./session";
import { MemoryKvStore } from "./store";
import { dispatchSession } from "./dispatch";

async function memberSession() {
  const s = new Session(new MemoryKvStore());
  const id = generateIdentityKeyPair();
  const kx = generateAgreementKeyPair();
  const fp = fingerprint(id.publicKey);
  await s.init({
    sessionId: "rdv_test",
    maxMembers: 2,
    creator: { fingerprint: fp, identityPub: bytesToHex(id.publicKey), kxPub: bytesToHex(kx.publicKey) },
  });
  return { s, id, fp };
}

function statusCtx(extra: Record<string, unknown> = {}) {
  return { sessionId: "rdv_test", method: "GET", path: "/status", params: new URLSearchParams(), body: undefined, ...extra };
}

describe("relay request auth (RDV-32)", () => {
  it("rejects a member-only request with no signature", async () => {
    const { s } = await memberSession();
    expect((await dispatchSession(s, statusCtx())).status).toBe(401);
  });

  it("accepts a validly signed request", async () => {
    const { s, id, fp } = await memberSession();
    const timestamp = String(Date.now());
    const signature = signRequest(id.privateKey, requestCanonical("GET", "/sessions/rdv_test/status", timestamp));
    expect((await dispatchSession(s, statusCtx({ member: fp, timestamp, signature }))).status).toBe(200);
  });

  it("rejects a signature from a non-member", async () => {
    const { s } = await memberSession();
    const outsider = generateIdentityKeyPair();
    const fp = fingerprint(outsider.publicKey);
    const timestamp = String(Date.now());
    const signature = signRequest(outsider.privateKey, requestCanonical("GET", "/sessions/rdv_test/status", timestamp));
    expect((await dispatchSession(s, statusCtx({ member: fp, timestamp, signature }))).status).toBe(401);
  });

  it("rejects a stale timestamp", async () => {
    const { s, id, fp } = await memberSession();
    const timestamp = String(Date.now() - 600_000);
    const signature = signRequest(id.privateKey, requestCanonical("GET", "/sessions/rdv_test/status", timestamp));
    expect((await dispatchSession(s, statusCtx({ member: fp, timestamp, signature }))).status).toBe(401);
  });
});
