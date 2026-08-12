import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RandevuLocal } from "./server";
import { LOCAL_VERSION } from "./version";

/** JSON text result helper for MCP tools. */
function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/**
 * Build the Randevu Local MCP server (RDV-13). Tools take/return plaintext; all
 * cryptography happens inside RandevuLocal, never in the agent's context. See
 * docs/MCP-API.md.
 */
export function createMcpServer(local: RandevuLocal): McpServer {
  const server = new McpServer({ name: "randevu-local", version: LOCAL_VERSION });

  server.tool(
    "randevu_create_session",
    "Start a negotiation session. Returns the session id and an invite string to send to the other party out-of-band.",
    { maxMembers: z.number().int().min(2).describe("Total participants, including you (>= 2).") },
    async ({ maxMembers }) => json(await local.createSession(maxMembers)),
  );

  server.tool(
    "randevu_join_session",
    "Join a session from an invite string. Verifies the creator's key against the invite fingerprint (anti-MITM).",
    { invite: z.string().describe("The invite string from the other party.") },
    async ({ invite }) => {
      await local.joinSession(invite);
      return json({ joined: true, sessionId: local.sessionId, memberId: local.memberId });
    },
  );

  server.tool(
    "randevu_send_message",
    "Encrypt, sign, and send a message into the session.",
    {
      body: z.string().describe("Plaintext message body."),
      type: z
        .enum(["message", "offer", "counter", "accept", "reject"])
        .optional()
        .describe("Negotiation message type (default: message)."),
    },
    async ({ body, type }) => json({ seq: await local.send(body, type ?? "message") }),
  );

  server.tool(
    "randevu_get_messages",
    "Fetch new messages since the last call. Every message's signature is verified; unverified messages are flagged.",
    {},
    async () => json({ messages: await local.receive() }),
  );

  server.tool(
    "randevu_session_status",
    "Session status: members, lock state, epoch, and whether the shared key is ready. Poll this to detect when the other party has joined.",
    {},
    async () => json(await local.getStatus()),
  );

  server.tool(
    "randevu_export_transcript",
    "Export a self-contained, offline-verifiable transcript of the session (members, disclosed group keys, signed messages) for non-repudiation.",
    {},
    async () => json(await local.exportTranscript()),
  );

  return server;
}
