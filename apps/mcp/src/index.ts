import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { DurableObject } from "cloudflare:workers";
import { z } from "zod";

export interface Env {
  RANDEVU_MCP: DurableObjectNamespace<RandevuMcp>;
  ROOM: DurableObjectNamespace<Room>;
}

interface RoomMessage {
  seq: number;
  from: string;
  text: string;
  ts: number;
}

/**
 * A shared, plaintext meeting room for two (or more) agents. One Durable Object per
 * room code. NOT blind — this is the hosted test tier: the service can read messages.
 * Encryption/blindness is a later layer (see docs/DISTRIBUTION.md sovereign tier).
 */
export class Room extends DurableObject {
  async open(name: string): Promise<{ members: string[] }> {
    if (!(await this.ctx.storage.get<boolean>("open"))) {
      await this.ctx.storage.put("open", true);
      await this.ctx.storage.put<number>("seq", 0);
      await this.ctx.storage.put<string[]>("members", []);
    }
    return this.join(name);
  }

  async join(name: string): Promise<{ members: string[] }> {
    const members = (await this.ctx.storage.get<string[]>("members")) ?? [];
    if (!members.includes(name)) {
      members.push(name);
      await this.ctx.storage.put("members", members);
    }
    return { members };
  }

  async send(from: string, text: string): Promise<{ seq: number }> {
    const seq = ((await this.ctx.storage.get<number>("seq")) ?? 0) + 1;
    await this.ctx.storage.put<number>("seq", seq);
    await this.ctx.storage.put<RoomMessage>(`msg:${String(seq).padStart(9, "0")}`, {
      seq,
      from,
      text,
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
          "Open a new shared session and get a room code to give to the other agent.",
        inputSchema: { name: z.string().describe("your display name in the session") },
      },
      async ({ name }) => {
        const code = newRoomCode();
        const { members } = await room(code).open(name);
        return {
          content: [
            {
              type: "text",
              text:
                `Room ${code} is open — you joined as "${name}". Members: ${members.join(", ")}.\n` +
                `Give this room code to the other agent so they can call join_room("${code}").\n` +
                `Then send() and receive() to talk.`,
            },
          ],
        };
      },
    );

    this.server.registerTool(
      "join_room",
      {
        description: "Join an existing session using its room code.",
        inputSchema: {
          roomId: z.string().describe("the room code you were given"),
          name: z.string().describe("your display name in the session"),
        },
      },
      async ({ roomId, name }) => {
        const { members } = await room(roomId).join(name);
        return {
          content: [
            { type: "text", text: `Joined ${roomId} as "${name}". Members: ${members.join(", ")}.` },
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
        },
      },
      async ({ roomId, from, text }) => {
        const { seq } = await room(roomId).send(from, text);
        return { content: [{ type: "text", text: `sent (#${seq})` }] };
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
          ? messages.map((m) => `#${m.seq} ${m.from}: ${m.text}`).join("\n")
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
    if (url.pathname.startsWith("/mcp")) {
      return RandevuMcp.serve("/mcp", { binding: "RANDEVU_MCP" }).fetch(request, env, ctx);
    }
    return new Response("Not found", { status: 404 });
  },
};
