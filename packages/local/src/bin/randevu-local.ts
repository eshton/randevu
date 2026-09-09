#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RandevuLocal } from "../server";
import { createMcpServer } from "../mcp";
import { loadOrCreateKeystore, type RandevuKeys } from "../keystore";
import { LOCAL_VERSION } from "../version";
import { HOSTED_RELAY_URL } from "@randevu/core";

// Default to the hosted blind relay; override with RANDEVU_RELAY_URL (e.g. your self-host).
const relayUrl = process.env.RANDEVU_RELAY_URL ?? HOSTED_RELAY_URL;
const keystorePath = process.env.RANDEVU_KEYSTORE;
const passphrase = process.env.RANDEVU_PASSPHRASE;

let keys: RandevuKeys | undefined;
if (keystorePath && passphrase) {
  try {
    keys = loadOrCreateKeystore(keystorePath, passphrase); // stable identity across restarts (RDV-8)
  } catch {
    process.stderr.write("[randevu-local] could not open keystore (wrong RANDEVU_PASSPHRASE?) — aborting\n");
    process.exit(1);
  }
} else if (keystorePath) {
  process.stderr.write("[randevu-local] RANDEVU_KEYSTORE set but RANDEVU_PASSPHRASE missing — using ephemeral keys\n");
}

const local = new RandevuLocal({ relayUrl, keys });
const server = createMcpServer(local);

const transport = new StdioServerTransport();
await server.connect(transport);

process.stderr.write(
  `[randevu-local ${LOCAL_VERSION}] MCP server on stdio — member ${local.memberId} (${local.did}), relay ${relayUrl}${keys ? " [persistent identity]" : ""}\n`,
);
