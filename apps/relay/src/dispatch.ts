import { Session, SessionError, type MemberInput, type StoredMessage } from "./session";

export interface DispatchCtx {
  sessionId: string;
  method: string;
  path: string;
  params: URLSearchParams;
  body: unknown;
}

export interface DispatchResult {
  status: number;
  body: unknown;
}

/**
 * Framework-agnostic routing from an HTTP-ish request to Session methods.
 * Shared by the Durable Object shell and by in-process test relays, so both
 * exercise identical behavior.
 */
export async function dispatchSession(session: Session, ctx: DispatchCtx): Promise<DispatchResult> {
  const { sessionId, method, path, params, body } = ctx;
  try {
    if (path === "/init" && method === "POST") {
      const b = body as { maxMembers: number; creator: MemberInput };
      return ok(await session.init({ sessionId, maxMembers: b.maxMembers, creator: b.creator }));
    }
    if (path === "/join" && method === "POST") {
      const b = body as { joinToken: string; member: MemberInput };
      return ok(await session.join(b));
    }
    if (path === "/members" && method === "GET") {
      return ok({ members: await session.members() });
    }
    if (path === "/messages" && method === "POST") {
      return ok(await session.postMessage(body as Omit<StoredMessage, "seq">));
    }
    if (path === "/messages" && method === "GET") {
      return ok(await session.getMessages(Number(params.get("after") ?? "0")));
    }
    if (path === "/keys" && method === "POST") {
      return ok(
        await session.postKeys(
          body as { senderId: string; epoch: number; wraps: { recipientId: string; wrappedKey: string }[] },
        ),
      );
    }
    if (path === "/keys" && method === "GET") {
      return ok(await session.getKey(Number(params.get("epoch") ?? "0"), params.get("member") ?? ""));
    }
    if (path === "/status" && method === "GET") {
      return ok(await session.status());
    }
    return { status: 404, body: { error: "not_found" } };
  } catch (err) {
    if (err instanceof SessionError) {
      return { status: err.status, body: { error: err.code } };
    }
    throw err;
  }
}

function ok(body: unknown): DispatchResult {
  return { status: 200, body };
}
