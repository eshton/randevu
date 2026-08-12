#!/usr/bin/env node
import { createRandevuServer, LOCAL_VERSION } from "../index";

const relayUrl = process.env.RANDEVU_RELAY_URL ?? "https://relay.randevu.dev";

const server = createRandevuServer({ relayUrl });

// TODO(RDV-13): connect a stdio transport (@modelcontextprotocol/sdk) and serve
// the tools defined in docs/MCP-API.md. For now this is a scaffold entrypoint.
process.stderr.write(
  `[randevu-local ${LOCAL_VERSION}] scaffold — member ${server.memberId}, relay ${server.relay.endpoint}. MCP wiring pending (RDV-13).\n`,
);
