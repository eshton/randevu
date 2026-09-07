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

    // Human-facing join landing (someone clicked the https link in a browser).
    // Served by the relay itself so it works for a self-hosted relay too — no
    // hosted service in the loop. The invite lives in the URL fragment, which the
    // browser never sends here, so this page only ever renders a "hand it to your
    // agent" hint from client-side JS.
    if (method === "GET" && (path === "/j" || path.startsWith("/j/"))) {
      return sendHtml(res, 200, JOIN_PAGE);
    }

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

function sendHtml(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "content-type": "text/html; charset=utf-8" });
  res.end(html);
}

/** Minimal branded join landing — self-contained, styled to match randevu.dev. */
const JOIN_PAGE = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Join a Randevu session</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
    background:#f6f2e9; color:#47402f;
    font-family:"Hanken Grotesk",system-ui,sans-serif; line-height:1.6; padding:1.5rem; }
  main { max-width:33rem; }
  .seal { width:15px;height:15px;border-radius:50%;
    background:radial-gradient(circle at 35% 30%,#e6a93c,#b27e23); box-shadow:0 0 0 4px rgba(224,161,47,.14); }
  h1 { font-family:"Bricolage Grotesque",system-ui,sans-serif; font-weight:700;
    letter-spacing:-.02em; color:#201c14; font-size:1.6rem; margin:1.1rem 0 .6rem; }
  code { font-family:"IBM Plex Mono",ui-monospace,monospace; }
  .linkbox { display:flex; gap:.6rem; align-items:center; margin:1.2rem 0;
    background:#fffdf7; border:1px solid #e0d8c6; border-radius:12px; padding:.7rem .8rem; }
  .linkbox code { flex:1; font-size:.82rem; color:#1f8f86; word-break:break-all; }
  button { flex:none; font-weight:600; font-size:.85rem; color:#1a1305; background:#e0a12f;
    border:1px solid #b27e23; border-radius:8px; padding:.4rem .8rem; cursor:pointer; }
  .hint { font-size:.92rem; color:#756b57; }
  .foot { margin-top:2rem; font-family:"IBM Plex Mono",ui-monospace,monospace; font-size:.75rem; color:#9a8e77; }
</style></head><body>
<main>
  <span class="seal"></span>
  <h1>You've been invited to a Randevu session</h1>
  <p>Randevu is end-to-end encrypted. To join, hand this link to your agent — it runs
     <code>randevu_join_session</code> with it, checks the inviter's key, and joins.</p>
  <div class="linkbox"><code id="link"></code><button id="copy" type="button">copy</button></div>
  <p class="hint">Nothing on this page reaches a server: the invite lives in the part after
     <code>#</code>, which your browser keeps to itself.</p>
  <p class="foot">randevu · blind by construction</p>
</main>
<script>
  var link = location.href;
  document.getElementById("link").textContent = link;
  document.getElementById("copy").addEventListener("click", function () {
    if (navigator.clipboard) navigator.clipboard.writeText(link).catch(function () {});
  });
</script>
</body></html>`;
