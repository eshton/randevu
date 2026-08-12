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
  didKeyFromEd25519,
  type IdentityKeyPair,
  type AgreementKeyPair,
  type MessageType,
  type SignableEnvelope,
} from "@randevu/core";
import { RelayClient, type FetchLike, type MemberDTO } from "@randevu/relay-client";

export interface RandevuLocalOptions {
  relayUrl: string;
  fetch?: FetchLike;
}

export interface ReceivedMessage {
  seq: number;
  senderId: string;
  type: MessageType;
  body: string;
  /** True only if the sender's signature verified against their pinned identity key. */
  verified: boolean;
}

/**
 * Randevu Local — the trusted, key-holding half of Randevu. Generates the party's
 * keypairs, does all encryption/signing locally, and talks to the blind relay via
 * @randevu/relay-client. The MCP stdio surface (RDV-13) wraps these methods.
 */
export class RandevuLocal {
  private readonly identity: IdentityKeyPair = generateIdentityKeyPair();
  private readonly agreement: AgreementKeyPair = generateAgreementKeyPair();
  readonly memberId: string = fingerprint(this.identity.publicKey);
  private readonly relay: RelayClient;

  sessionId?: string;
  epoch = 0;
  private groupKey?: Uint8Array;
  private cursor = 0;
  private readonly membersById = new Map<string, MemberDTO>();

  constructor(options: RandevuLocalOptions) {
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
  }

  /** Member path: fetch and unwrap this member's group key for the current epoch. */
  async syncGroupKey(): Promise<void> {
    const sessionId = this.requireSession();
    const status = await this.relay.status(sessionId);
    this.epoch = status.epoch;
    this.cache(status.members);
    const { wrappedKey } = await this.relay.getKey(sessionId, this.epoch, this.memberId);
    this.groupKey = unwrapGroupKey(hexToBytes(wrappedKey), this.agreement);
  }

  /** Encrypt + sign a message and post it. Returns the relay-assigned seq. */
  async send(body: string, type: MessageType = "message"): Promise<number> {
    const sessionId = this.requireSession();
    if (!this.groupKey) throw new Error("no group key — call establishGroupKey/syncGroupKey first");
    const ctx = { sessionId, epoch: this.epoch, senderId: this.memberId };
    const enc = encryptMessage(this.groupKey, ctx, body);
    const env: SignableEnvelope = { ...ctx, type, prevHash: null, nonce: enc.nonce, ciphertext: enc.ciphertext };
    const signature = signMessage(env, this.identity.privateKey);
    const { seq } = await this.relay.postMessage(sessionId, {
      epoch: this.epoch,
      senderId: this.memberId,
      ciphertext: bytesToHex(enc.ciphertext),
      nonce: bytesToHex(enc.nonce),
      signature: bytesToHex(signature),
      type,
      prevHash: null,
    });
    return seq;
  }

  /** Fetch new messages since the cursor, verify every signature, decrypt verified ones. */
  async receive(): Promise<ReceivedMessage[]> {
    const sessionId = this.requireSession();
    if (!this.groupKey) throw new Error("no group key");
    const { messages, cursor } = await this.relay.getMessages(sessionId, this.cursor);
    this.cursor = cursor;

    const out: ReceivedMessage[] = [];
    for (const m of messages) {
      if (m.senderId === this.memberId) continue; // don't re-consume our own messages
      const ctx = { sessionId, epoch: m.epoch, senderId: m.senderId };
      const sender = this.membersById.get(m.senderId);
      const type = m.type as MessageType;
      let verified = false;
      let body = "";
      if (sender) {
        const env: SignableEnvelope = {
          ...ctx,
          type,
          prevHash: m.prevHash ? hexToBytes(m.prevHash) : null,
          nonce: hexToBytes(m.nonce),
          ciphertext: hexToBytes(m.ciphertext),
        };
        verified = verifyMessage(env, hexToBytes(m.signature), hexToBytes(sender.identityPub));
      }
      if (verified) {
        body = decryptMessage(this.groupKey, ctx, {
          nonce: hexToBytes(m.nonce),
          ciphertext: hexToBytes(m.ciphertext),
        });
      }
      out.push({ seq: m.seq, senderId: m.senderId, type, body, verified });
    }
    return out;
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
