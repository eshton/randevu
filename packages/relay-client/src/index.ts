import { VERSION } from "@randevu/core";

export interface RelayClientOptions {
  /** Base URL of the Randevu Relay (e.g. https://relay.randevu.dev). */
  baseUrl: string;
  /** Injectable fetch (defaults to global fetch). */
  fetch?: typeof fetch;
}

export interface CreateSessionInput {
  maxMembers: number;
}

/**
 * Typed client for the Randevu Relay HTTP API.
 *
 * The relay is BLIND: every payload this client sends or receives is ciphertext
 * or public-key material. Private keys and plaintext never pass through here —
 * that all lives in @randevu/local. Methods are stubs pending RDV-3..7.
 */
export class RelayClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RelayClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  /** Protocol version this client speaks. */
  get protocolVersion(): string {
    return VERSION;
  }

  /** Relay base URL (normalized, no trailing slash). */
  get endpoint(): string {
    return this.baseUrl;
  }

  /** Allocate a new session. Returns session_id + one-time join token (RDV-3). */
  async createSession(_input: CreateSessionInput): Promise<never> {
    void this.fetchImpl;
    throw new Error("not implemented: RDV-3");
  }
}
