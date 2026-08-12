import { sha256 } from "@noble/hashes/sha256";
import { randomBytes, bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import type { KvStore } from "./store";

/** A member's public key material. All fields are opaque to the relay (it stays blind). */
export interface MemberInput {
  /** Identity fingerprint (BLAKE2b of the identity pubkey) — the member id. */
  fingerprint: string;
  /** Ed25519 identity public key (hex). */
  identityPub: string;
  /** X25519 key-agreement public key (hex). */
  kxPub: string;
}

export interface Member extends MemberInput {
  joinedSeq: number;
}

export interface SessionMeta {
  sessionId: string;
  maxMembers: number;
  locked: boolean;
  /** Bumped on every membership change; the current group-key generation. */
  epoch: number;
  /** The key-holder — only this member may post group keys (RDV-34). */
  creatorId: string;
}

/** A group key sealed to one member, plus the holder's signed commitment (RDV-34). */
export interface StoredWrappedKey {
  wrappedKey: string;
  commitment: string;
  signature: string;
}

export interface StoredMessage {
  seq: number;
  epoch: number;
  senderId: string;
  /** AEAD ciphertext (hex/base64) — opaque. */
  ciphertext: string;
  /** 24-byte nonce (hex) — opaque. */
  nonce: string;
  /** Ed25519 signature (hex) — opaque. */
  signature: string;
  type: string;
  prevHash: string | null;
  /** Content-id of a referenced message (e.g. an accept's offer); null if none. Opaque. */
  ref: string | null;
}

export class SessionError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "SessionError";
  }
}

const KEY = {
  meta: "meta",
  seq: "seq",
  member: (fp: string) => `member:${fp}`,
  token: (hash: string) => `token:${hash}`,
  msg: (seq: number) => `msg:${String(seq).padStart(12, "0")}`,
  gkey: (epoch: number, fp: string) => `gkey:${epoch}:${fp}`,
};

function sha256Hex(input: string): string {
  return bytesToHex(sha256(utf8ToBytes(input)));
}

function randomToken(): string {
  return bytesToHex(randomBytes(16));
}

/**
 * Pure session logic for one Randevu session. Runs on a KvStore; the Durable
 * Object serializes all calls, so no locking is needed and `seq` is monotonic.
 * The relay stores only ciphertext + public keys — it never sees plaintext.
 */
export class Session {
  constructor(private readonly store: KvStore) {}

  private async meta(): Promise<SessionMeta> {
    const m = await this.store.get<SessionMeta>(KEY.meta);
    if (!m) throw new SessionError(404, "session_not_found");
    return m;
  }

  /** RDV-3/4/6: create the session, register the creator, mint a one-time join token. */
  async init(input: {
    sessionId: string;
    maxMembers: number;
    creator: MemberInput;
  }): Promise<{ sessionId: string; joinToken: string; memberId: string }> {
    if (await this.store.get<SessionMeta>(KEY.meta)) {
      throw new SessionError(409, "session_exists");
    }
    if (input.maxMembers < 2) throw new SessionError(400, "max_members_too_small");

    const meta: SessionMeta = {
      sessionId: input.sessionId,
      maxMembers: input.maxMembers,
      locked: false,
      epoch: 0,
      creatorId: input.creator.fingerprint,
    };
    const token = randomToken();

    await this.store.put(KEY.meta, meta);
    await this.store.put<number>(KEY.seq, 0);
    await this.store.put<Member>(KEY.member(input.creator.fingerprint), {
      ...input.creator,
      joinedSeq: 0,
    });
    // Token stays valid until the session locks (bounded by maxMembers), so one
    // invite can admit N parties. One-time-per-invite is a future hardening.
    await this.store.put(KEY.token(sha256Hex(token)), true);

    return { sessionId: meta.sessionId, joinToken: token, memberId: input.creator.fingerprint };
  }

  /** RDV-3/6: join with a one-time token; lock when maxMembers reached; bump epoch. */
  async join(input: {
    joinToken: string;
    member: MemberInput;
  }): Promise<{ members: Member[]; epoch: number; locked: boolean }> {
    const meta = await this.meta();
    if (meta.locked) throw new SessionError(423, "session_locked");

    const valid = await this.store.get<boolean>(KEY.token(sha256Hex(input.joinToken)));
    if (!valid) throw new SessionError(403, "invalid_join_token");

    if (await this.store.get<Member>(KEY.member(input.member.fingerprint))) {
      throw new SessionError(409, "member_exists");
    }

    const seq = (await this.store.get<number>(KEY.seq)) ?? 0;
    await this.store.put<Member>(KEY.member(input.member.fingerprint), {
      ...input.member,
      joinedSeq: seq,
    });

    meta.epoch += 1; // membership change → new group-key generation
    const members = await this.members();
    if (members.length >= meta.maxMembers) meta.locked = true;
    await this.store.put(KEY.meta, meta);

    return { members, epoch: meta.epoch, locked: meta.locked };
  }

  /** The identity public key registered for a member (for request auth, RDV-32). */
  async memberIdentityPub(fingerprint: string): Promise<string | undefined> {
    const m = await this.store.get<Member>(KEY.member(fingerprint));
    return m?.identityPub;
  }

  /** RDV-4: list member public keys. */
  async members(): Promise<Member[]> {
    const map = await this.store.list<Member>("member:");
    return [...map.values()].sort((a, b) => a.joinedSeq - b.joinedSeq);
  }

  private async requireMember(fingerprint: string): Promise<void> {
    if (!(await this.store.get<Member>(KEY.member(fingerprint)))) {
      throw new SessionError(403, "not_a_member");
    }
  }

  /** RDV-5: append a ciphertext message; assign a monotonic seq. */
  async postMessage(input: Omit<StoredMessage, "seq">): Promise<{ seq: number }> {
    await this.meta();
    await this.requireMember(input.senderId);
    const seq = ((await this.store.get<number>(KEY.seq)) ?? 0) + 1;
    await this.store.put<number>(KEY.seq, seq);
    await this.store.put<StoredMessage>(KEY.msg(seq), { ...input, seq });
    return { seq };
  }

  /** RDV-7: poll for messages after a cursor. */
  async getMessages(afterSeq = 0): Promise<{ messages: StoredMessage[]; cursor: number }> {
    await this.meta();
    const map = await this.store.list<StoredMessage>("msg:");
    const messages = [...map.values()].filter((m) => m.seq > afterSeq).sort((a, b) => a.seq - b.seq);
    const cursor = messages.length ? messages[messages.length - 1]!.seq : afterSeq;
    return { messages, cursor };
  }

  /** RDV-10/34: store group-key copies wrapped to each member. Key-holder (creator) only. */
  async postKeys(input: {
    senderId: string;
    epoch: number;
    keyCommitment: string;
    signature: string;
    wraps: { recipientId: string; wrappedKey: string }[];
  }): Promise<{ ok: true }> {
    const meta = await this.meta();
    await this.requireMember(input.senderId);
    if (input.senderId !== meta.creatorId) throw new SessionError(403, "not_key_holder");
    for (const w of input.wraps) {
      await this.store.put<StoredWrappedKey>(KEY.gkey(input.epoch, w.recipientId), {
        wrappedKey: w.wrappedKey,
        commitment: input.keyCommitment,
        signature: input.signature,
      });
    }
    return { ok: true };
  }

  /** RDV-10/34: fetch this member's wrapped group key + the holder's signed commitment. */
  async getKey(epoch: number, memberId: string): Promise<StoredWrappedKey> {
    await this.meta();
    const entry = await this.store.get<StoredWrappedKey>(KEY.gkey(epoch, memberId));
    if (!entry) throw new SessionError(404, "key_not_found");
    return entry;
  }

  /** RDV: session status incl. member list, lock state, epoch, message count. */
  async status(): Promise<{
    sessionId: string;
    creatorId: string;
    locked: boolean;
    epoch: number;
    members: Member[];
    lastSeq: number;
  }> {
    const meta = await this.meta();
    const lastSeq = (await this.store.get<number>(KEY.seq)) ?? 0;
    return {
      sessionId: meta.sessionId,
      creatorId: meta.creatorId,
      locked: meta.locked,
      epoch: meta.epoch,
      members: await this.members(),
      lastSeq,
    };
  }
}
