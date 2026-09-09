import { Waiters } from "@randevu/core";
import { Session } from "./session";
import { authenticate, dispatchSession } from "./dispatch";
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

  list<T>(prefix: string, opts?: { start?: string }): Promise<Map<string, T>> {
    return this.storage.list<T>({ prefix, ...(opts?.start !== undefined ? { start: opts.start } : {}) });
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
  private readonly waiters = new Waiters();

  constructor(
    private readonly state: DurableObjectState,
    _env: unknown,
  ) {
    this.session = new Session(new DurableKvStore(this.state.storage));
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const sessionId = request.headers.get("X-Randevu-Session") ?? "";
    const method = request.method;
    const member = request.headers.get("X-Randevu-Member") ?? undefined;
    const timestamp = request.headers.get("X-Randevu-Timestamp") ?? undefined;
    const signature = request.headers.get("X-Randevu-Auth") ?? undefined;

    try {
      // Long-poll: block until a message after `after` exists, then return it (push-like).
      if (url.pathname === "/wait" && method === "GET") {
        return await this.handleWait(sessionId, url.searchParams, method, member, timestamp, signature);
      }

      const body =
        method === "GET" || method === "HEAD"
          ? undefined
          : await request.json().catch(() => undefined);

      // Serialize handlers so `seq` stays strictly monotonic under concurrency.
      const result = await this.state.blockConcurrencyWhile(() =>
        dispatchSession(this.session, {
          sessionId,
          method,
          path: url.pathname,
          params: url.searchParams,
          body,
          member,
          timestamp,
          signature,
        }),
      );
      if (url.pathname === "/messages" && method === "POST" && result.status === 200) this.waiters.wakeAll();
      return Response.json(result.body, { status: result.status });
    } catch {
      return Response.json({ error: "internal_error" }, { status: 500 });
    }
  }

  private async handleWait(
    sessionId: string,
    params: URLSearchParams,
    method: string,
    member?: string,
    timestamp?: string,
    signature?: string,
  ): Promise<Response> {
    // Same auth scheme as every other member-only path (RDV-32) — shared, not re-implemented.
    const ok = await this.state.blockConcurrencyWhile(() =>
      authenticate(this.session, { sessionId, method, path: "/wait", params, body: undefined, member, timestamp, signature }),
    );
    if (!ok) return Response.json({ error: "unauthenticated" }, { status: 401 });

    // /wait is a raw HTTP boundary — never trust the query is numeric.
    const afterRaw = Number(params.get("after") ?? "0");
    const after = Number.isFinite(afterRaw) ? afterRaw : 0;
    const timeoutRaw = Number(params.get("timeout") ?? "25000");
    const timeoutMs = Number.isFinite(timeoutRaw) ? Math.min(55_000, Math.max(1_000, timeoutRaw)) : 25_000;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      // Short serialized read for the current messages; the wait itself is NOT held under
      // blockConcurrencyWhile, so a concurrent postMessage can proceed and wake() us.
      const res = await this.state.blockConcurrencyWhile(() => this.session.getMessages(after));
      if (res.messages.length) return Response.json(res, { status: 200 });
      const remaining = deadline - Date.now();
      if (remaining <= 0) return Response.json({ messages: [], cursor: after }, { status: 200 });
      await this.waiters.wait(remaining);
    }
  }
}
