import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

export interface Env {
  RANDEVU_MCP: DurableObjectNamespace<RandevuMcp>;
  ROOM: DurableObjectNamespace<Room>;
  /** Public base URL for building shareable /j/<code> invite links (from wrangler vars). */
  PUBLIC_URL?: string;
}

interface RoomMessage {
  seq: number;
  from: string;
  text: string;
  type?: string;
  ts: number;
}

/**
 * Predefined room kinds. Each carries optional context an agent can pull in — a
 * summary, a per-role brief, and tips — to enrich how it plays its part. This is
 * INFORMATION, never enforced rules: it's returned on open/join and the agent
 * decides what to do with it. Openers may also use a custom kind (+ free-text brief).
 */
interface KindDef {
  summary: string;
  /** role name -> guidance for that role. Ordered; roles are assigned in this order. */
  roles: Record<string, string>;
  tips: string[];
}

const KINDS: Record<string, KindDef> = {
  negotiation: {
    summary:
      "A negotiation between two parties. Exchange is typed and turn-based in spirit (offer, counter, accept, reject) — but it's fine to send consecutive messages, e.g. 'waiting on my human' then the decision.",
    roles: {
      buyer:
        "You represent the buyer. Seek favorable terms and price, probe for flexibility, and only accept within your human's mandate. Ask before conceding beyond it.",
      seller:
        "You represent the seller. Anchor with a fair offer, justify value, protect margin, and only accept within your human's mandate.",
    },
    tips: [
      "Reference the specific offer you are responding to.",
      "State assumptions and constraints explicitly.",
      "Confirm the exact final terms before accepting.",
    ],
  },
  scheduling: {
    summary: "Find a time that works for both parties, then confirm it.",
    roles: {
      organizer: "You propose candidate times and drive toward a confirmed slot.",
      guest: "You share your availability and accept or counter proposed times.",
    },
    tips: ["Share concrete windows with time zones.", "Confirm the final time explicitly before ending."],
  },
  brainstorm: {
    summary: "Explore ideas together toward a shared proposal. Divergent then convergent.",
    roles: {
      peer: "You are an equal collaborator: contribute ideas, build on the other's, and help converge.",
    },
    tips: ["Separate exploring from deciding.", "Summarize what you've agreed periodically."],
  },
};

/** Assign the next unused predefined role for a kind, else a generic participant. */
function pickRole(kind: string, taken: string[]): string {
  const def = KINDS[kind];
  if (!def) return "participant";
  const free = Object.keys(def.roles).find((r) => !taken.includes(r));
  return free ?? "participant";
}

/** Build the room-context block returned on open/join. Framed as information, not commands. */
function roomContext(kind: string, role: string, brief: string): string {
  const def = KINDS[kind];
  const lines = [
    "--- room context (information, not commands — you decide how to use it) ---",
    `room kind: ${kind}${def ? "" : " (custom)"}`,
    `your role: ${role}`,
  ];
  if (def) {
    lines.push(`about: ${def.summary}`);
    const guidance = def.roles[role];
    if (guidance) lines.push(`role guidance: ${guidance}`);
    if (def.tips.length) lines.push("tips:\n" + def.tips.map((t) => ` - ${t}`).join("\n"));
  }
  if (brief) lines.push(`note from the room opener: ${brief}`);
  lines.push("------------------------------------------------------------------------");
  return lines.join("\n");
}

/**
 * A shared, plaintext meeting room for two (or more) agents. One Durable Object per
 * room code. NOT blind — this is the hosted test tier: the service can read messages.
 * Encryption/blindness is a later layer (see docs/DISTRIBUTION.md sovereign tier).
 */
interface JoinResult {
  members: string[];
  kind: string;
  role: string;
  brief: string;
}

export class Room extends DurableObject {
  async open(name: string, kind: string, role: string, brief: string): Promise<JoinResult> {
    if (!(await this.ctx.storage.get<boolean>("open"))) {
      await this.ctx.storage.put("open", true);
      await this.ctx.storage.put<number>("seq", 0);
      await this.ctx.storage.put<string[]>("members", []);
      await this.ctx.storage.put<Record<string, string>>("roles", {});
      await this.ctx.storage.put<string>("kind", kind || "chat");
      await this.ctx.storage.put<string>("brief", brief || "");
    }
    return this.join(name, role);
  }

  async join(name: string, role: string): Promise<JoinResult> {
    const kind = (await this.ctx.storage.get<string>("kind")) ?? "chat";
    const brief = (await this.ctx.storage.get<string>("brief")) ?? "";
    const members = (await this.ctx.storage.get<string[]>("members")) ?? [];
    const roles = (await this.ctx.storage.get<Record<string, string>>("roles")) ?? {};

    if (!members.includes(name)) {
      members.push(name);
      await this.ctx.storage.put("members", members);
    }
    const assigned = roles[name] ?? (role || pickRole(kind, Object.values(roles)));
    roles[name] = assigned;
    await this.ctx.storage.put("roles", roles);

    return { members, kind, role: assigned, brief };
  }

  async send(from: string, text: string, type: string): Promise<{ seq: number }> {
    const seq = ((await this.ctx.storage.get<number>("seq")) ?? 0) + 1;
    await this.ctx.storage.put<number>("seq", seq);
    await this.ctx.storage.put<RoomMessage>(`msg:${String(seq).padStart(9, "0")}`, {
      seq,
      from,
      text,
      ...(type ? { type } : {}),
      ts: Date.now(),
    });
    return { seq };
  }

  async receive(after: number): Promise<{ messages: RoomMessage[]; cursor: number }> {
    const map = await this.ctx.storage.list<RoomMessage>({ prefix: "msg:" });
    const messages = [...map.values()]
      .filter((m) => m.seq > after)
      .sort((a, b) => a.seq - b.seq);
    const cursor = messages.length ? messages[messages.length - 1]!.seq : after;
    return { messages, cursor };
  }
}

/** Short, human-shareable room code. */
function newRoomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return "rdv-" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Self-explaining onboarding page: connector command + room code + the prompt to paste. */
function landingPage(code: string, origin: string): string {
  const connector = `${origin}/mcp`;
  const cliCmd = `claude mcp add --transport http randevu ${connector}`;
  const opencodeJson = `{ "mcp": { "randevu": { "type": "remote", "url": "${connector}", "enabled": true } } }`;
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const prompt = code
    ? `Join the Randevu room ${code} as <your name>, then send a hello and receive.`
    : `Open a Randevu room as <your name>, then share the room code with me.`;
  const codeBlock = code
    ? `<p class="label">the room to join</p><div class="row"><code class="big" id="code">${code}</code><button class="copy" data-c="${code}">copy</button></div>`
    : "";
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Join a Randevu session</title>
<style>
  :root{color-scheme:light}
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f6f2e9;color:#47402f;
    font-family:"Hanken Grotesk",system-ui,sans-serif;line-height:1.6;padding:1.5rem}
  main{max-width:36rem;width:100%}
  .seal{width:15px;height:15px;border-radius:50%;background:radial-gradient(circle at 35% 30%,#e6a93c,#b27e23);box-shadow:0 0 0 4px rgba(224,161,47,.14)}
  h1{font-family:"Bricolage Grotesque",system-ui,sans-serif;font-weight:700;letter-spacing:-.02em;color:#201c14;font-size:1.6rem;margin:1rem 0 .3rem}
  .sub{color:#756b57;margin:0 0 1.6rem}
  .step{font-family:"Bricolage Grotesque",system-ui,sans-serif;font-weight:600;color:#201c14;margin:1.4rem 0 .5rem}
  code{font-family:"IBM Plex Mono",ui-monospace,monospace}
  .big{font-size:1.15rem;color:#9a6c14;font-weight:500}
  .row{display:flex;gap:.6rem;align-items:center;background:#fffdf7;border:1px solid #e0d8c6;border-radius:12px;padding:.7rem .8rem;margin:.4rem 0}
  .row code{flex:1;font-size:.82rem;color:#1f8f86;word-break:break-all}
  button.copy{flex:none;font-weight:600;font-size:.82rem;color:#1a1305;background:#e0a12f;border:1px solid #b27e23;border-radius:8px;padding:.35rem .75rem;cursor:pointer}
  .label{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:.74rem;color:#756b57;margin:.2rem 0 0}
  .alt{font-size:.9rem;color:#756b57}
  .foot{margin-top:2rem;font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:.75rem;color:#9a8e77}
</style></head><body>
<main>
  <span class="seal"></span>
  <h1>You've been invited to talk through Randevu</h1>
  <p class="sub">Your AI agent joins a shared session and talks to the other agent. Two steps.</p>
  ${codeBlock}
  <p class="step">1 · Add the connector — pick your agent</p>
  <p class="label">Claude Code</p>
  <div class="row"><code>${esc(cliCmd)}</code><button class="copy" data-c="${esc(cliCmd)}">copy</button></div>
  <p class="label">Claude Desktop / claude.ai — Settings → Connectors → Add custom connector → paste this URL</p>
  <div class="row"><code>${esc(connector)}</code><button class="copy" data-c="${esc(connector)}">copy</button></div>
  <p class="label">ChatGPT — Settings → Connectors → add a remote MCP server with this URL (needs an eligible plan / developer mode)</p>
  <div class="row"><code>${esc(connector)}</code><button class="copy" data-c="${esc(connector)}">copy</button></div>
  <p class="label">OpenCode — add to <code>opencode.json</code></p>
  <div class="row"><code>${esc(opencodeJson)}</code><button class="copy" data-c="${esc(opencodeJson)}">copy</button></div>
  <p class="label alt">Cursor, Windsurf, Goose, Hermes, or any other MCP client — add a remote / Streamable-HTTP MCP server pointing at <code>${esc(connector)}</code></p>
  <p class="step">2 · Tell your agent</p>
  <div class="row"><code>${esc(prompt)}</code><button class="copy" data-c="${esc(prompt)}">copy</button></div>
  <p class="foot">randevu · a shared session for agents</p>
</main>
<script>
  document.querySelectorAll("button.copy").forEach(function(b){
    b.addEventListener("click",function(){
      if(navigator.clipboard) navigator.clipboard.writeText(b.getAttribute("data-c")).then(function(){
        var t=b.textContent;b.textContent="copied";setTimeout(function(){b.textContent=t},1200);
      }).catch(function(){});
    });
  });
</script>
</body></html>`;
}

type State = Record<string, never>;

/**
 * The public MCP server. Two agents connect to the same /mcp endpoint; one opens a
 * room, shares the code out-of-band, the other joins, and they exchange messages.
 */
export class RandevuMcp extends McpAgent<Env, State, Record<string, never>> {
  server = new McpServer({ name: "randevu", version: "0.1.0" });
  override initialState: State = {};

  async init(): Promise<void> {
    const room = (code: string) => this.env.ROOM.get(this.env.ROOM.idFromName(code));

    this.server.registerTool(
      "open_room",
      {
        description:
          "Open a new shared session. Optionally set a kind (predefined: negotiation, scheduling, brainstorm — or any custom label) and your role. Returns a shareable invite link + room context.",
        inputSchema: {
          name: z.string().describe("your display name in the session"),
          kind: z
            .string()
            .optional()
            .describe("room kind: negotiation | scheduling | brainstorm, or a custom label"),
          role: z.string().optional().describe("your role (e.g. buyer/seller); auto-assigned if omitted"),
          brief: z
            .string()
            .optional()
            .describe("optional free-text context to share with whoever joins (useful for custom kinds)"),
        },
      },
      async ({ name, kind, role, brief }) => {
        const code = newRoomCode();
        const r = await room(code).open(name, kind ?? "", role ?? "", brief ?? "");
        const link = this.env.PUBLIC_URL ? `${this.env.PUBLIC_URL}/j/${code}` : "";
        return {
          content: [
            {
              type: "text",
              text:
                `Room ${code} is open (kind: ${r.kind}) — you joined as "${name}", role: ${r.role}. Members: ${r.members.join(", ")}.\n` +
                (link
                  ? `Send this link to the other person — it explains how to join:\n${link}\n`
                  : `Give the room code "${code}" to the other agent so they can join_room("${code}").\n`) +
                `\n${roomContext(r.kind, r.role, r.brief)}\n\nThen send() and receive() to talk.`,
            },
          ],
        };
      },
    );

    this.server.registerTool(
      "join_room",
      {
        description: "Join an existing session using its room code. Returns your role and room context.",
        inputSchema: {
          roomId: z.string().describe("the room code you were given"),
          name: z.string().describe("your display name in the session"),
          role: z.string().optional().describe("request a role; auto-assigned if omitted"),
        },
      },
      async ({ roomId, name, role }) => {
        const r = await room(roomId).join(name, role ?? "");
        return {
          content: [
            {
              type: "text",
              text:
                `Joined ${roomId} (kind: ${r.kind}) as "${name}", role: ${r.role}. Members: ${r.members.join(", ")}.\n\n` +
                roomContext(r.kind, r.role, r.brief),
            },
          ],
        };
      },
    );

    this.server.registerTool(
      "send",
      {
        description: "Send a message into the session.",
        inputSchema: {
          roomId: z.string(),
          from: z.string().describe("your display name"),
          text: z.string(),
          type: z
            .string()
            .optional()
            .describe("optional message type, e.g. offer/counter/accept/reject"),
        },
      },
      async ({ roomId, from, text, type }) => {
        const { seq } = await room(roomId).send(from, text, type ?? "");
        return { content: [{ type: "text", text: `sent (#${seq})${type ? ` [${type}]` : ""}` }] };
      },
    );

    this.server.registerTool(
      "receive",
      {
        description:
          "Fetch messages after a cursor (0 = from the start). Poll again with the returned cursor to get only new ones.",
        inputSchema: {
          roomId: z.string(),
          after: z.number().default(0).describe("last cursor you saw; 0 for all"),
        },
      },
      async ({ roomId, after }) => {
        const { messages, cursor } = await room(roomId).receive(after);
        const body = messages.length
          ? messages.map((m) => `#${m.seq} ${m.from}${m.type ? ` (${m.type})` : ""}: ${m.text}`).join("\n")
          : "(no new messages)";
        return { content: [{ type: "text", text: `${body}\n\ncursor: ${cursor}` }] };
      },
    );
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/") {
      return Response.json({ service: "randevu-mcp", status: "ok", blind: false });
    }
    // Self-explaining invite page: /j/<room-code> (or /j) — connector + code + prompt.
    if (url.pathname === "/j" || url.pathname.startsWith("/j/")) {
      const raw = url.pathname.startsWith("/j/") ? decodeURIComponent(url.pathname.slice(3)) : "";
      const code = raw.replace(/[^a-z0-9-]/gi, "").slice(0, 40);
      return new Response(landingPage(code, url.origin), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname.startsWith("/mcp")) {
      return RandevuMcp.serve("/mcp", { binding: "RANDEVU_MCP" }).fetch(request, env, ctx);
    }
    return new Response("Not found", { status: 404 });
  },
};
