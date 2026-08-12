import { Hono } from "hono";
import { SessionDurableObject } from "./session-do";

export { SessionDurableObject };

interface Env {
  SESSION: DurableObjectNamespace;
}

const app = new Hono<{ Bindings: Env }>();

app.get("/", (c) =>
  c.json({ service: "randevu-relay", status: "ok", blind: true }),
);

/**
 * Route session-scoped requests to that session's Durable Object.
 * The DO id is derived from the session id, so all traffic for one session
 * serializes through a single object (free monotonic seq).
 */
app.all("/sessions/:id", (c) => routeToSession(c.env, c.req.param("id"), c.req.raw));
app.all("/sessions/:id/*", (c) => routeToSession(c.env, c.req.param("id"), c.req.raw));

function routeToSession(env: Env, sessionId: string, request: Request): Promise<Response> {
  const stub = env.SESSION.get(env.SESSION.idFromName(sessionId));
  return stub.fetch(request);
}

export default app;
