import { hexToBytes } from "@noble/hashes/utils";
import { requestCanonical, verifyRequest } from "@randevu/core";
import { Session, SessionError, type MemberInput, type StoredMessage } from "./session";

export interface DispatchCtx {
  sessionId: string;
  method: string;
  path: string;
  params: URLSearchParams;
  body: unknown;
  /** Request-auth headers (RDV-32). */
  member?: string;
  timestamp?: string;
  signature?: string;
}

export interface DispatchResult {
  status: number;
  body: unknown;
}

/** Paths that require a valid member request signature (RDV-32). init/join bootstrap membership. */
const MEMBER_ONLY = new Set(["/members", "/messages", "/keys", "/status"]);
const MAX_SKEW_MS = 300_000;

async function authenticate(session: Session, ctx: DispatchCtx): Promise<boolean> {
  if (!ctx.member || !ctx.timestamp || !ctx.signature) return false;
  const ts = Number(ctx.timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) return false;
  const pub = await session.memberIdentityPub(ctx.member);
  if (!pub) return false;
  const canonical = requestCanonical(ctx.method, `/sessions/${ctx.sessionId}${ctx.path}`, ctx.timestamp);
  return verifyRequest(hexToBytes(pub), canonical, ctx.signature);
}

/**
 * Framework-agnostic routing from an HTTP-ish request to Session methods.
 * Shared by the Durable Object shell and by in-process test relays, so both
 * exercise identical behavior.
 */
export async function dispatchSession(session: Session, ctx: DispatchCtx): Promise<DispatchResult> {
  const { sessionId, method, path, params, body } = ctx;
  try {
    if (MEMBER_ONLY.has(path) && !(await authenticate(session, ctx))) {
      return { status: 401, body: { error: "unauthenticated" } };
    }
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
          body as {
            senderId: string;
            epoch: number;
            keyCommitment: string;
            signature: string;
            wraps: { recipientId: string; wrappedKey: string }[];
          },
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
