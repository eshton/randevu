import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse, Server } from "node:http";
import { randomBytes } from "node:crypto";
import { Session, dispatchSession, MemoryKvStore } from "@randevu/relay";

export interface NodeRelay {
  /** Base URL to point a RelayClient at, e.g. http://127.0.0.1:8787. */
  url: string;
  port: number;
  server: Server;
  close(): Promise<void>;
}

const HEALTH = { service: "randevu-relay", status: "ok", blind: true, host: "node" };

/**
 * A blind Randevu relay on plain Node — the same session engine the Cloudflare
 * Worker runs (`@randevu/relay`), served over `node:http`. Each session gets its
 * own in-memory store; writes per session are serialized so `seq` stays strictly
 * monotonic, replacing the Durable Object's `blockConcurrencyWhile`.
 *
 * State is in-memory: sessions live only while the process runs.
 */
export async function startNodeRelay(port = 0, host = "127.0.0.1"): Promise<NodeRelay> {
  const sessions = new Map<string, Session>();
  const tails = new Map<string, Promise<unknown>>();

  /** Chain `task` after the session's previous op so seq assignment can't interleave. */
  function serialize<T>(id: string, task: () => Promise<T>): Promise<T> {
    const prev = tails.get(id) ?? Promise.resolve();
    const run = prev.then(task, task);
    tails.set(
      id,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://relay");
    const method = req.method ?? "GET";
    const path = url.pathname;

    if (path === "/") return sendJson(res, 200, HEALTH);

    const body =
      method === "GET" || method === "HEAD" ? undefined : await readJson(req);
    const auth = {
      method,
      params: url.searchParams,
      body,
      member: header(req, "x-randevu-member"),
      timestamp: header(req, "x-randevu-timestamp"),
      signature: header(req, "x-randevu-auth"),
    };

    // Create: mint an id, spin up a fresh session, run /init on it.
    if (path === "/sessions" && method === "POST") {
      const sessionId = `rdv_${randomBytes(16).toString("hex")}`;
      const session = new Session(new MemoryKvStore());
      sessions.set(sessionId, session);
      const result = await serialize(sessionId, () =>
        dispatchSession(session, { ...auth, sessionId, path: "/init" }),
      );
      return sendJson(res, result.status, result.body);
    }

    // Session-scoped: /sessions/:id -> /status ; /sessions/:id/<sub> -> /<sub>.
    if (path.startsWith("/sessions/")) {
      const rest = path.slice("/sessions/".length);
      const slash = rest.indexOf("/");
      const sessionId = slash === -1 ? rest : rest.slice(0, slash);
      const sub = slash === -1 ? "/status" : rest.slice(slash);
      const session = sessions.get(sessionId);
      if (!session) return sendJson(res, 404, { error: "session_not_found" });
      const result = await serialize(sessionId, () =>
        dispatchSession(session, { ...auth, sessionId, path: sub }),
      );
      return sendJson(res, result.status, result.body);
    }

    return sendJson(res, 404, { error: "not_found" });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(() => sendJson(res, 500, { error: "internal_error" }));
  });

  await new Promise<void>((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    url: `http://${host}:${actualPort}`,
    port: actualPort,
    server,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return Array.isArray(v) ? v[0] : v;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(payload);
}
