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
    const body =
      method === "GET" || method === "HEAD"
        ? undefined
        : await request.json().catch(() => undefined);

    try {
      // Serialize handlers so `seq` stays strictly monotonic under concurrency.
      const result = await this.state.blockConcurrencyWhile(() =>
        dispatchSession(this.session, {
          sessionId,
          method,
          path: url.pathname,
          params: url.searchParams,
          body,
          member: request.headers.get("X-Randevu-Member") ?? undefined,
          timestamp: request.headers.get("X-Randevu-Timestamp") ?? undefined,
          signature: request.headers.get("X-Randevu-Auth") ?? undefined,
        }),
      );
      return Response.json(result.body, { status: result.status });
    } catch {
      return Response.json({ error: "internal_error" }, { status: 500 });
    }
  }
}
