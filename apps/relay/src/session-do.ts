import { requestCanonical, verifyRequest } from "@randevu/core";
import { hexToBytes } from "@noble/hashes/utils";
import { Session } from "./session";
import { dispatchSession } from "./dispatch";
import type { KvStore } from "./store";

/** Adapts Durable Object storage to the KvStore interface the session logic uses. */
class DurableKvStore implements KvStore {
  constructor(private readonly storage: DurableObjectStorage) {}

  get<T>(key: string): Promise<T | undefined> {
    return this.storage.get<T>(key);
  }

  async put<T>(key: string, value: T): Promise<void> {
    await this.storage.put(key, value);
  }

  async delete(key: string): Promise<void> {
    await this.storage.delete(key);
  }

  list<T>(prefix: string): Promise<Map<string, T>> {
    return this.storage.list<T>({ prefix });
  }
}

/**
 * SessionDurableObject — one Durable Object per Randevu session (see docs/STACK.md).
 * Serialized writes give a free monotonic seq; per-session storage holds members,
 * public keys, wrapped group keys, and ciphertext. Blind: only ciphertext + public
 * keys are ever stored.
 */
export class SessionDurableObject implements DurableObject {
  private readonly session: Session;
  /** In-memory long-poll waiters, released when a new message is posted. */
  private waiters: Array<() => void> = [];

  constructor(
    private readonly state: DurableObjectState,
    _env: unknown,
  ) {
    this.session = new Session(new DurableKvStore(this.state.storage));
  }

  private wake(): void {
    const pending = this.waiters;
    this.waiters = [];
    for (const resolve of pending) resolve();
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const sessionId = request.headers.get("X-Randevu-Session") ?? "";
    const method = request.method;
    const member = request.headers.get("X-Randevu-Member") ?? undefined;
    const timestamp = request.headers.get("X-Randevu-Timestamp") ?? undefined;
    const signature = request.headers.get("X-Randevu-Auth") ?? undefined;

    // Long-poll: block until a message after `after` exists, then return it (push-like).
    if (url.pathname === "/wait" && method === "GET") {
      return this.handleWait(sessionId, url.searchParams, member, timestamp, signature);
    }

    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : await request.json().catch(() => undefined);

    try {
      // Serialize handlers so `seq` stays strictly monotonic under concurrency.
      const result = await this.state.blockConcurrencyWhile(() =>
        dispatchSession(this.session, { sessionId, method, path: url.pathname, params: url.searchParams, body, member, timestamp, signature }),
      );
      if (url.pathname === "/messages" && method === "POST" && result.status === 200) this.wake();
      return Response.json(result.body, { status: result.status });
    } catch {
      return Response.json({ error: "internal_error" }, { status: 500 });
    }
  }

  /** Verify a signed request for this member (same scheme as dispatch, for the /wait path). */
  private async authOk(
    sessionId: string,
    member?: string,
    timestamp?: string,
    signature?: string,
  ): Promise<boolean> {
    if (!member || !timestamp || !signature) return false;
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > 300_000) return false;
    const pub = await this.state.blockConcurrencyWhile(() => this.session.memberIdentityPub(member));
    if (!pub) return false;
    return verifyRequest(hexToBytes(pub), requestCanonical("GET", `/sessions/${sessionId}/wait`, timestamp), signature);
  }

  private async handleWait(
    sessionId: string,
    params: URLSearchParams,
    member?: string,
    timestamp?: string,
    signature?: string,
  ): Promise<Response> {
    if (!(await this.authOk(sessionId, member, timestamp, signature))) {
      return Response.json({ error: "unauthenticated" }, { status: 401 });
    }
    const after = Number(params.get("after") ?? "0");
    const timeoutMs = Math.min(55_000, Math.max(1_000, Number(params.get("timeout") ?? "25000")));
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      // Short serialized read for the current messages; the wait itself is NOT held under
      // blockConcurrencyWhile, so a concurrent postMessage can proceed and wake() us.
      const res = await this.state.blockConcurrencyWhile(() => this.session.getMessages(after));
      if (res.messages.length) return Response.json(res, { status: 200 });
      const remaining = deadline - Date.now();
      if (remaining <= 0) return Response.json({ messages: [], cursor: after }, { status: 200 });
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}
