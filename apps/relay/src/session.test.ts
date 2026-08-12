import { describe, it, expect } from "vitest";
import { Session, SessionError, type MemberInput } from "./session";
import { MemoryKvStore } from "./store";

function member(fp: string): MemberInput {
  return { fingerprint: fp, identityPub: `id_${fp}`, kxPub: `kx_${fp}` };
}

function newSession(): Session {
  return new Session(new MemoryKvStore());
}

async function initedSession(maxMembers: number) {
  const s = newSession();
  const { joinToken } = await s.init({ sessionId: "rdv_test", maxMembers, creator: member("aaaa") });
  return { s, joinToken };
}

describe("Session lifecycle (RDV-3/4/6)", () => {
  it("init returns id + token + creator id; re-init conflicts", async () => {
    const s = newSession();
    const res = await s.init({ sessionId: "rdv_test", maxMembers: 3, creator: member("aaaa") });
    expect(res.sessionId).toBe("rdv_test");
    expect(res.joinToken).toMatch(/^[0-9a-f]{32}$/);
    expect(res.memberId).toBe("aaaa");
    await expect(
      s.init({ sessionId: "rdv_test", maxMembers: 3, creator: member("aaaa") }),
    ).rejects.toBeInstanceOf(SessionError);
  });

  it("rejects maxMembers < 2", async () => {
    const s = newSession();
    await expect(
      s.init({ sessionId: "x", maxMembers: 1, creator: member("aaaa") }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("join with a valid token adds a member and bumps epoch", async () => {
    const { s, joinToken } = await initedSession(3);
    const res = await s.join({ joinToken, member: member("bbbb") });
    expect(res.epoch).toBe(1);
    expect(res.locked).toBe(false);
    expect(res.members.map((m) => m.fingerprint)).toEqual(["aaaa", "bbbb"]);
  });

  it("locks at maxMembers and rejects further joins", async () => {
    const { s, joinToken } = await initedSession(2);
    const joined = await s.join({ joinToken, member: member("bbbb") });
    expect(joined.locked).toBe(true);
    await expect(s.join({ joinToken, member: member("cccc") })).rejects.toMatchObject({
      status: 423,
    });
  });

  it("supports multi-party: one invite admits N members until locked", async () => {
    const { s, joinToken } = await initedSession(3);
    await s.join({ joinToken, member: member("bbbb") });
    const third = await s.join({ joinToken, member: member("cccc") });
    expect(third.locked).toBe(true);
    expect(third.members).toHaveLength(3);
  });

  it("rejects an unknown join token and duplicate members", async () => {
    const { s, joinToken } = await initedSession(3);
    await expect(s.join({ joinToken: "deadbeef", member: member("bbbb") })).rejects.toMatchObject({
      status: 403,
    });
    await s.join({ joinToken, member: member("bbbb") });
    await expect(s.join({ joinToken, member: member("bbbb") })).rejects.toMatchObject({
      status: 409,
    });
  });
});

describe("Messages (RDV-5/7)", () => {
  function msg(senderId: string, extra: Record<string, unknown> = {}) {
    return {
      epoch: 1,
      senderId,
      ciphertext: "ct",
      nonce: "n",
      signature: "sig",
      type: "message",
      prevHash: null,
      ...extra,
    };
  }

  it("assigns monotonic seq and rejects non-members", async () => {
    const { s, joinToken } = await initedSession(3);
    await s.join({ joinToken, member: member("bbbb") });
    expect((await s.postMessage(msg("aaaa"))).seq).toBe(1);
    expect((await s.postMessage(msg("bbbb"))).seq).toBe(2);
    await expect(s.postMessage(msg("zzzz"))).rejects.toMatchObject({ status: 403 });
  });

  it("poll cursor returns only messages after the given seq", async () => {
    const { s } = await initedSession(3);
    await s.postMessage(msg("aaaa"));
    await s.postMessage(msg("aaaa"));
    await s.postMessage(msg("aaaa"));
    const all = await s.getMessages(0);
    expect(all.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(all.cursor).toBe(3);
    const tail = await s.getMessages(2);
    expect(tail.messages.map((m) => m.seq)).toEqual([3]);
    expect(tail.cursor).toBe(3);
  });
});

describe("Group key storage (RDV-10 support)", () => {
  it("stores wrapped keys per member and serves them back", async () => {
    const { s, joinToken } = await initedSession(3);
    await s.join({ joinToken, member: member("bbbb") });
    await s.postKeys({
      senderId: "aaaa",
      epoch: 1,
      wraps: [
        { recipientId: "aaaa", wrappedKey: "wrapped_a" },
        { recipientId: "bbbb", wrappedKey: "wrapped_b" },
      ],
    });
    expect((await s.getKey(1, "bbbb")).wrappedKey).toBe("wrapped_b");
    await expect(s.getKey(1, "zzzz")).rejects.toMatchObject({ status: 404 });
  });
});

describe("Status", () => {
  it("reports members, epoch, lock, and lastSeq", async () => {
    const { s, joinToken } = await initedSession(2);
    await s.join({ joinToken, member: member("bbbb") });
    await s.postMessage({
      epoch: 1,
      senderId: "aaaa",
      ciphertext: "ct",
      nonce: "n",
      signature: "sig",
      type: "message",
      prevHash: null,
    });
    const st = await s.status();
    expect(st.sessionId).toBe("rdv_test");
    expect(st.locked).toBe(true);
    expect(st.epoch).toBe(1);
    expect(st.members).toHaveLength(2);
    expect(st.lastSeq).toBe(1);
  });
});
