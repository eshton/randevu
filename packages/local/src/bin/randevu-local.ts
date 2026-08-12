#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RandevuLocal } from "../server";
import { createMcpServer } from "../mcp";
import { LOCAL_VERSION } from "../version";

const relayUrl = process.env.RANDEVU_RELAY_URL ?? "https://relay.randevu.dev";
const local = new RandevuLocal({ relayUrl });
const server = createMcpServer(local);

const transport = new StdioServerTransport();
await server.connect(transport);

process.stderr.write(
  `[randevu-local ${LOCAL_VERSION}] MCP server on stdio — member ${local.memberId} (${local.did}), relay ${relayUrl}\n`,
);
