import { Session, SessionError, type MemberInput, type StoredMessage } from "./session";
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
 *
 * NOTE: request-signature auth (reject non-members at the edge) is a follow-up; E2E
 * guarantees hold regardless of relay auth.
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
    const path = url.pathname;
    const sessionId = request.headers.get("X-Randevu-Session") ?? "";

    try {
      // Serialize handlers against concurrent requests for a strict monotonic seq.
      return await this.state.blockConcurrencyWhile(() =>
        this.route(request, path, url, sessionId),
      );
    } catch (err) {
      if (err instanceof SessionError) {
        return Response.json({ error: err.code }, { status: err.status });
      }
      return Response.json({ error: "internal_error" }, { status: 500 });
    }
  }

  private async route(
    request: Request,
    path: string,
    url: URL,
    sessionId: string,
  ): Promise<Response> {
    const method = request.method;

    if (path === "/init" && method === "POST") {
      const body = (await request.json()) as { maxMembers: number; creator: MemberInput };
      return Response.json(
        await this.session.init({ sessionId, maxMembers: body.maxMembers, creator: body.creator }),
      );
    }

    if (path === "/join" && method === "POST") {
      const body = (await request.json()) as { joinToken: string; member: MemberInput };
      return Response.json(await this.session.join(body));
    }

    if (path === "/members" && method === "GET") {
      return Response.json({ members: await this.session.members() });
    }

    if (path === "/messages" && method === "POST") {
      const body = (await request.json()) as Omit<StoredMessage, "seq">;
      return Response.json(await this.session.postMessage(body));
    }

    if (path === "/messages" && method === "GET") {
      const after = Number(url.searchParams.get("after") ?? "0");
      return Response.json(await this.session.getMessages(after));
    }

    if (path === "/keys" && method === "POST") {
      const body = (await request.json()) as {
        senderId: string;
        epoch: number;
        wraps: { recipientId: string; wrappedKey: string }[];
      };
      return Response.json(await this.session.postKeys(body));
    }

    if (path === "/keys" && method === "GET") {
      const epoch = Number(url.searchParams.get("epoch") ?? "0");
      const member = url.searchParams.get("member") ?? "";
      return Response.json(await this.session.getKey(epoch, member));
    }

    if (path === "/status" && method === "GET") {
      return Response.json(await this.session.status());
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  }
}
