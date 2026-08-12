import { hexToBytes, bytesToHex } from "@noble/hashes/utils";
import {
  generateIdentityKeyPair,
  generateAgreementKeyPair,
  fingerprint,
  encodeInvite,
  parseInvite,
  generateGroupKey,
  wrapGroupKey,
  unwrapGroupKey,
  encryptMessage,
  decryptMessage,
  signMessage,
  verifyMessage,
  messageSigningBytes,
  messageId,
  chainHash,
  didKeyFromEd25519,
  type IdentityKeyPair,
  type AgreementKeyPair,
  type MessageType,
  type SignableEnvelope,
  type TranscriptBundle,
} from "@randevu/core";
import { RelayClient, RelayError, type FetchLike, type MemberDTO, type MessageDTO } from "@randevu/relay-client";

/** Nullable byte-array equality (both null counts as equal). */
function bytesEqualNullable(a: Uint8Array | null, b: Uint8Array | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

interface LogEntry {
  seq: number;
  senderId: string;
  type: MessageType;
  /** Signature verified AND transcript-chain position matched. */
  verified: boolean;
  chainOk: boolean;
  body: string;
  /** Content-id of this message. */
  id: string;
  /** Raw wire message, retained for transcript export (RDV-15). */
  dto: MessageDTO;
}

export interface RandevuLocalOptions {
  relayUrl: string;
  fetch?: FetchLike;
  /** Persisted identity + agreement keypairs (e.g. from a keystore). Generated fresh if omitted. */
  keys?: { identity: IdentityKeyPair; agreement: AgreementKeyPair };
}

export interface ReceivedMessage {
  seq: number;
  /** Content-id — reference this to accept/reject/counter these exact terms. */
  id: string;
  senderId: string;
  type: MessageType;
  body: string;
  /** Content-id this message references (e.g. the offer an accept binds to); null if none. */
  ref: string | null;
  /** True only if the sender's signature verified against their pinned identity key. */
  verified: boolean;
}

/**
 * Randevu Local — the trusted, key-holding half of Randevu. Generates the party's
 * keypairs, does all encryption/signing locally, and talks to the blind relay via
 * @randevu/relay-client. The MCP stdio surface (RDV-13) wraps these methods.
 */
export class RandevuLocal {
  private readonly identity: IdentityKeyPair;
  private readonly agreement: AgreementKeyPair;
  readonly memberId: string;
  private readonly relay: RelayClient;

  sessionId?: string;
  epoch = 0;
  private role?: "creator" | "member";
  private groupKey?: Uint8Array;
  /** All group keys this member has held, by epoch — disclosed in an exported transcript. */
  private readonly groupKeys = new Map<number, Uint8Array>();
  private establishedEpoch = -1;
  /** Running transcript hash folded over the seq-ordered log (RDV-12). */
  private head: Uint8Array | null = null;
  /** Last seq folded into `head` and cached in `log`. */
  private fetchedSeq = 0;
  /** Last seq delivered to the agent via receive(). */
  private inboxSeq = 0;
  private readonly log: LogEntry[] = [];
  private readonly membersById = new Map<string, MemberDTO>();

  constructor(options: RandevuLocalOptions) {
    this.identity = options.keys?.identity ?? generateIdentityKeyPair();
    this.agreement = options.keys?.agreement ?? generateAgreementKeyPair();
    this.memberId = fingerprint(this.identity.publicKey);
    this.relay = new RelayClient({ baseUrl: options.relayUrl, fetch: options.fetch });
  }

  /** This member's public identity as a did:key (interop). */
  get did(): string {
    return didKeyFromEd25519(this.identity.publicKey);
  }

  private selfDTO(): MemberDTO {
    return {
      fingerprint: this.memberId,
      identityPub: bytesToHex(this.identity.publicKey),
      kxPub: bytesToHex(this.agreement.publicKey),
    };
  }

  private cache(members: MemberDTO[]): void {
    for (const m of members) this.membersById.set(m.fingerprint, m);
  }

  /** Create a session; returns the id and the out-of-band invite string. */
  async createSession(maxMembers: number): Promise<{ sessionId: string; invite: string }> {
    const res = await this.relay.createSession({ maxMembers, creator: this.selfDTO() });
    this.sessionId = res.sessionId;
    this.role = "creator";
    this.cache([this.selfDTO()]);
    const invite = encodeInvite({
      sessionId: res.sessionId,
      fingerprint: this.memberId,
      joinToken: res.joinToken,
    });
    return { sessionId: res.sessionId, invite };
  }

  /** Join a session from an invite, verifying the creator's key against the invite fingerprint. */
  async joinSession(invite: string): Promise<void> {
    const parsed = parseInvite(invite);
    this.sessionId = parsed.sessionId;
    this.role = "member";
    const res = await this.relay.joinSession(parsed.sessionId, {
      joinToken: parsed.joinToken,
      member: this.selfDTO(),
    });
    this.epoch = res.epoch;

    // Anti-MITM: the creator's published key must match the invite's committed fingerprint.
    const creator = res.members.find((m) => m.fingerprint === parsed.fingerprint);
    if (!creator) throw new Error("creator not present in session");
    if (fingerprint(hexToBytes(creator.identityPub)) !== parsed.fingerprint) {
      throw new Error("creator fingerprint mismatch — possible MITM");
    }
    this.cache(res.members);
  }

  /** Key-holder path: generate the epoch group key and wrap it to every member. */
  async establishGroupKey(): Promise<void> {
    const sessionId = this.requireSession();
    const status = await this.relay.status(sessionId);
    this.epoch = status.epoch;
    this.cache(status.members);

    const gk = generateGroupKey();
    const wraps = status.members.map((m) => ({
      recipientId: m.fingerprint,
      wrappedKey: bytesToHex(wrapGroupKey(gk, hexToBytes(m.kxPub))),
    }));
    await this.relay.postKeys(sessionId, { senderId: this.memberId, epoch: this.epoch, wraps });
    this.groupKey = gk;
    this.groupKeys.set(this.epoch, gk);
    this.establishedEpoch = this.epoch;
  }

  /** Member path: fetch and unwrap this member's group key for the current epoch. */
  async syncGroupKey(): Promise<void> {
    const sessionId = this.requireSession();
    const status = await this.relay.status(sessionId);
    this.epoch = status.epoch;
    this.cache(status.members);
    const { wrappedKey } = await this.relay.getKey(sessionId, this.epoch, this.memberId);
    this.groupKey = unwrapGroupKey(hexToBytes(wrappedKey), this.agreement);
    this.groupKeys.set(this.epoch, this.groupKey);
  }

  /**
   * Idempotently converge the group key for the current epoch. The creator
   * (re)generates and posts the key when membership changes; a member fetches +
   * unwraps it, tolerating a not-yet-posted key. Called automatically by
   * send/receive/getStatus so the MCP flow needs no explicit key step.
   */
  async ensureKeys(): Promise<boolean> {
    const sessionId = this.requireSession();
    const status = await this.relay.status(sessionId);
    this.cache(status.members);

    if (this.role === "creator") {
      if (!this.groupKey || status.epoch !== this.establishedEpoch) {
        this.epoch = status.epoch;
        const gk = generateGroupKey();
        const wraps = status.members.map((m) => ({
          recipientId: m.fingerprint,
          wrappedKey: bytesToHex(wrapGroupKey(gk, hexToBytes(m.kxPub))),
        }));
        await this.relay.postKeys(sessionId, { senderId: this.memberId, epoch: status.epoch, wraps });
        this.groupKey = gk;
        this.groupKeys.set(status.epoch, gk);
        this.establishedEpoch = status.epoch;
      }
      return true;
    }

    if (!this.groupKey || status.epoch !== this.epoch) {
      try {
        const { wrappedKey } = await this.relay.getKey(sessionId, status.epoch, this.memberId);
        this.groupKey = unwrapGroupKey(hexToBytes(wrappedKey), this.agreement);
        this.groupKeys.set(status.epoch, this.groupKey);
        this.epoch = status.epoch;
      } catch (err) {
        if (err instanceof RelayError && err.status === 404) return false; // key not posted yet
        throw err;
      }
    }
    return this.groupKey !== undefined;
  }

  /** Session status for the agent; converges the group key as a side effect. */
  async getStatus(): Promise<{
    sessionId: string;
    memberId: string;
    role: "creator" | "member" | "unknown";
    locked: boolean;
    epoch: number;
    members: string[];
    hasKey: boolean;
  }> {
    const sessionId = this.requireSession();
    const hasKey = await this.ensureKeys();
    const status = await this.relay.status(sessionId);
    return {
      sessionId,
      memberId: this.memberId,
      role: this.role ?? "unknown",
      locked: status.locked,
      epoch: status.epoch,
      members: status.members.map((m) => m.fingerprint),
      hasKey,
    };
  }

  /**
   * Fold newly-posted messages into the transcript head, verifying each signature
   * and its chain position (prevHash == our head-before). Idempotent per seq. This
   * is the transcript-integrity check (RDV-12): a relay that reorders, drops, or
   * inserts a message breaks continuity and every participant can see it.
   */
  private async pull(): Promise<void> {
    const sessionId = this.requireSession();
    const { messages } = await this.relay.getMessages(sessionId, this.fetchedSeq);
    for (const m of messages) {
      const ctx = { sessionId, epoch: m.epoch, senderId: m.senderId };
      const env: SignableEnvelope = {
        ...ctx,
        type: m.type as MessageType,
        prevHash: m.prevHash ? hexToBytes(m.prevHash) : null,
        ref: m.ref,
        nonce: hexToBytes(m.nonce),
        ciphertext: hexToBytes(m.ciphertext),
      };
      const sender = this.membersById.get(m.senderId);
      const sigOk = sender
        ? verifyMessage(env, hexToBytes(m.signature), hexToBytes(sender.identityPub))
        : false;
      const chainOk = bytesEqualNullable(env.prevHash, this.head);
      const id = messageId(env);
      this.head = chainHash(this.head, messageSigningBytes(env));

      const verified = sigOk && chainOk;
      let body = "";
      // Decrypt with the key for the message's OWN epoch (not just the current one).
      const key = this.groupKeys.get(m.epoch) ?? this.groupKey;
      if (verified && m.senderId !== this.memberId && key) {
        body = decryptMessage(key, ctx, { nonce: env.nonce, ciphertext: env.ciphertext });
      }
      this.log.push({ seq: m.seq, senderId: m.senderId, type: m.type as MessageType, verified, chainOk, body, id, dto: m });
      this.fetchedSeq = Math.max(this.fetchedSeq, m.seq);
    }
  }

  /**
   * Encrypt + sign a message (chained to the current transcript head) and post it.
   * `ref` binds this message to the content-id of another (e.g. an accept → its offer),
   * so acceptance of specific terms is non-repudiable.
   */
  async send(body: string, type: MessageType = "message", ref: string | null = null): Promise<number> {
    const sessionId = this.requireSession();
    await this.ensureKeys();
    if (!this.groupKey) throw new Error("group key not ready — the other party may not have joined yet");
    await this.pull(); // fold prior messages so prevHash reflects the current head
    const ctx = { sessionId, epoch: this.epoch, senderId: this.memberId };
    const enc = encryptMessage(this.groupKey, ctx, body);
    const env: SignableEnvelope = {
      ...ctx,
      type,
      prevHash: this.head,
      ref,
      nonce: enc.nonce,
      ciphertext: enc.ciphertext,
    };
    const signature = signMessage(env, this.identity.privateKey);
    const { seq } = await this.relay.postMessage(sessionId, {
      epoch: this.epoch,
      senderId: this.memberId,
      ciphertext: bytesToHex(enc.ciphertext),
      nonce: bytesToHex(enc.nonce),
      signature: bytesToHex(signature),
      type,
      prevHash: this.head ? bytesToHex(this.head) : null,
      ref,
    });
    return seq;
  }

  /** Make an offer. */
  offer(body: string): Promise<number> {
    return this.send(body, "offer");
  }

  /** Counter a prior message (optionally referencing it by content-id). */
  counter(body: string, ref: string | null = null): Promise<number> {
    return this.send(body, "counter", ref);
  }

  /** Sign off on the exact terms in message `ref` (non-repudiable acceptance). */
  accept(ref: string, note = ""): Promise<number> {
    return this.send(note, "accept", ref);
  }

  /** Reject the terms in message `ref`. */
  reject(ref: string, note = ""): Promise<number> {
    return this.send(note, "reject", ref);
  }

  /**
   * Deliver new messages to the agent: signatures verified, transcript chain
   * checked, verified ciphertext decrypted, own messages skipped.
   */
  async receive(): Promise<ReceivedMessage[]> {
    await this.ensureKeys();
    await this.pull();
    const out: ReceivedMessage[] = [];
    for (const entry of this.log) {
      if (entry.seq <= this.inboxSeq) continue;
      this.inboxSeq = entry.seq;
      if (entry.senderId === this.memberId) continue;
      out.push({
        seq: entry.seq,
        id: entry.id,
        senderId: entry.senderId,
        type: entry.type,
        body: entry.body,
        ref: entry.dto.ref,
        verified: entry.verified,
      });
    }
    return out;
  }

  /**
   * Export a self-contained, verifiable transcript (RDV-15). Includes members,
   * the group keys this member held (disclosed for adjudication), and every signed
   * message. Verify offline with `verifyTranscript` from @randevu/core.
   */
  async exportTranscript(): Promise<TranscriptBundle> {
    const sessionId = this.requireSession();
    await this.pull();
    return {
      version: "randevu-transcript/v1",
      sessionId,
      members: [...this.membersById.values()].map((m) => ({
        fingerprint: m.fingerprint,
        did: didKeyFromEd25519(hexToBytes(m.identityPub)),
        identityPub: m.identityPub,
      })),
      groupKeys: [...this.groupKeys.entries()].map(([epoch, key]) => ({ epoch, key: bytesToHex(key) })),
      messages: [...this.log]
        .sort((a, b) => a.seq - b.seq)
        .map((e) => ({
          seq: e.dto.seq,
          epoch: e.dto.epoch,
          senderId: e.dto.senderId,
          type: e.dto.type as MessageType,
          nonce: e.dto.nonce,
          ciphertext: e.dto.ciphertext,
          prevHash: e.dto.prevHash,
          ref: e.dto.ref,
          signature: e.dto.signature,
        })),
    };
  }

  private requireSession(): string {
    if (!this.sessionId) throw new Error("no active session");
    return this.sessionId;
  }
}

/** Convenience factory (kept for the MCP entrypoint). */
export function createRandevuServer(options: RandevuLocalOptions): RandevuLocal {
  return new RandevuLocal(options);
}
