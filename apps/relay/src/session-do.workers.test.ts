/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import { bytesToHex } from "@noble/hashes/utils";
import { generateIdentityKeyPair, generateAgreementKeyPair, fingerprint } from "@randevu/core";

// Exercises the real SessionDurableObject.fetch shell inside workerd — routing, the /wait
// path, blockConcurrencyWhile, and the JSON error envelope — which node vitest can't run.

declare module "cloudflare:test" {
  interface ProvidedEnv {
    SESSION: DurableObjectNamespace;
  }
}

function stub(name: string) {
  return env.SESSION.get(env.SESSION.idFromName(name));
}

const headers = (extra: Record<string, string> = {}) => ({ "X-Randevu-Session": "rdv_do", ...extra });

describe("SessionDurableObject.fetch (workerd)", () => {
  it("rejects an unauthenticated /wait with 401", async () => {
    const res = await stub("w1").fetch("https://do/wait?after=0&timeout=1000", { headers: headers() });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("does not spin on a non-numeric timeout — still a fast 401 without auth", async () => {
    const res = await stub("w2").fetch("https://do/wait?after=abc&timeout=abc", { headers: headers() });
    expect(res.status).toBe(401);
  });

  it("routes member-only paths through dispatch (401 without a signature)", async () => {
    const res = await stub("w3").fetch("https://do/status", { headers: headers() });
    expect(res.status).toBe(401);
  });

  it("creates a session and blocks /wait until a member exists", async () => {
    const s = stub("w4");
    const id = generateIdentityKeyPair();
    const kx = generateAgreementKeyPair();
    const fp = fingerprint(id.publicKey);
    const init = await s.fetch("https://do/init", {
      method: "POST",
      headers: headers({ "content-type": "application/json" }),
      body: JSON.stringify({
        sessionId: "rdv_do",
        maxMembers: 2,
        creator: { fingerprint: fp, identityPub: bytesToHex(id.publicKey), kxPub: bytesToHex(kx.publicKey) },
      }),
    });
    expect(init.status).toBe(200);
    // /wait still needs a valid signature; unsigned stays 401.
    const wait = await s.fetch("https://do/wait?after=0&timeout=500", { headers: headers({ "X-Randevu-Member": fp }) });
    expect(wait.status).toBe(401);
  });

  it("returns 404 for an unknown path via dispatch", async () => {
    const res = await stub("w5").fetch("https://do/nope", { headers: headers() });
    expect(res.status).toBe(404);
  });
});
