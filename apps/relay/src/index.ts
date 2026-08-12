import { Hono } from "hono";
import { randomBytes, bytesToHex } from "@noble/hashes/utils";
import { SessionDurableObject } from "./session-do";

export { SessionDurableObject };

interface Env {
  SESSION: DurableObjectNamespace;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) => c.json({ service: "randevu-relay", status: "ok", blind: true }));

/** Create a session: mint an id, route to its (fresh) Durable Object to initialize. */
app.post("/sessions", (c) => {
  const sessionId = `rdv_${bytesToHex(randomBytes(16))}`;
  return forward(c.env, sessionId, "/init", c.req.raw);
});

/** All session-scoped requests route to that session's Durable Object. */
app.all("/sessions/:id", (c) =>
  forward(c.env, c.req.param("id"), "/status", c.req.raw),
);
app.all("/sessions/:id/*", (c) => {
  const id = c.req.param("id");
  const prefix = `/sessions/${id}`;
  const suffix = new URL(c.req.url).pathname.slice(prefix.length) || "/";
  return forward(c.env, id, suffix, c.req.raw);
});

async function forward(
  env: Env,
  sessionId: string,
  subPath: string,
  request: Request,
): Promise<Response> {
  const stub = env.SESSION.get(env.SESSION.idFromName(sessionId));
  const search = new URL(request.url).search;
  const headers = new Headers(request.headers);
  headers.set("X-Randevu-Session", sessionId);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const body = hasBody ? await request.arrayBuffer() : undefined;
  return stub.fetch(new Request(`https://do${subPath}${search}`, { method: request.method, headers, body }));
}

export default app;
