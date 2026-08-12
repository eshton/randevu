import { VERSION, requestCanonical } from "@randevu/core";

/** Signs a canonical request descriptor; returns the member id + signature. Keys stay in the caller. */
export type RequestSigner = (canonical: string) => { member: string; signature: string };

/** Minimal fetch shape the client needs — global fetch satisfies it, and it's trivial to fake. */
export type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface RelayClientOptions {
  /** Base URL of the Randevu Relay. */
  baseUrl: string;
  fetch?: FetchLike;
  /** Optional per-request signer (RDV-32). The client never holds private keys itself. */
  signer?: RequestSigner;
}

/** A member's public key material — opaque to the relay. */
export interface MemberDTO {
  fingerprint: string;
  identityPub: string;
  kxPub: string;
  joinedSeq?: number;
}

/** A stored ciphertext message — opaque to the relay. */
export interface MessageDTO {
  seq: number;
  epoch: number;
  senderId: string;
  ciphertext: string;
  nonce: string;
  signature: string;
  type: string;
  prevHash: string | null;
  ref: string | null;
}

export class RelayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
    this.name = "RelayError";
  }
}

/**
 * Typed client for the Randevu Relay HTTP API. Every payload is ciphertext or
 * public-key material — private keys and plaintext live in @randevu/local, never here.
 */
export class RelayClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: FetchLike;
  private readonly signer?: RequestSigner;

  constructor(options: RelayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
    this.signer = options.signer;
  }

  get endpoint(): string {
    return this.baseUrl;
  }

  get protocolVersion(): string {
    return VERSION;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["content-type"] = "application/json";
    if (this.signer) {
      const fullPath = path.split("?")[0]!;
      const timestamp = String(Date.now());
      const { member, signature } = this.signer(requestCanonical(method, fullPath, timestamp));
      headers["x-randevu-member"] = member;
      headers["x-randevu-timestamp"] = timestamp;
      headers["x-randevu-auth"] = signature;
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new RelayError(res.status, (data["error"] as string) ?? "relay_error");
    }
    return data as T;
  }

  createSession(input: { maxMembers: number; creator: MemberDTO }) {
    return this.request<{ sessionId: string; joinToken: string; memberId: string }>(
      "POST",
      "/sessions",
      input,
    );
  }

  joinSession(sessionId: string, input: { joinToken: string; member: MemberDTO }) {
    return this.request<{ members: MemberDTO[]; epoch: number; locked: boolean }>(
      "POST",
      `/sessions/${sessionId}/join`,
      input,
    );
  }

  getMembers(sessionId: string) {
    return this.request<{ members: MemberDTO[] }>("GET", `/sessions/${sessionId}/members`);
  }

  postMessage(sessionId: string, msg: Omit<MessageDTO, "seq">) {
    return this.request<{ seq: number }>("POST", `/sessions/${sessionId}/messages`, msg);
  }

  getMessages(sessionId: string, afterSeq = 0) {
    return this.request<{ messages: MessageDTO[]; cursor: number }>(
      "GET",
      `/sessions/${sessionId}/messages?after=${afterSeq}`,
    );
  }

  postKeys(
    sessionId: string,
    input: {
      senderId: string;
      epoch: number;
      keyCommitment: string;
      signature: string;
      wraps: { recipientId: string; wrappedKey: string }[];
    },
  ) {
    return this.request<{ ok: true }>("POST", `/sessions/${sessionId}/keys`, input);
  }

  getKey(sessionId: string, epoch: number, member: string) {
    return this.request<{ wrappedKey: string; commitment: string; signature: string }>(
      "GET",
      `/sessions/${sessionId}/keys?epoch=${epoch}&member=${member}`,
    );
  }

  status(sessionId: string) {
    return this.request<{
      sessionId: string;
      creatorId: string;
      locked: boolean;
      epoch: number;
      members: MemberDTO[];
      lastSeq: number;
    }>("GET", `/sessions/${sessionId}/status`);
  }
}
