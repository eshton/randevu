#!/usr/bin/env node
import { RandevuLocal, LOCAL_VERSION } from "../index";

const relayUrl = process.env.RANDEVU_RELAY_URL ?? "https://relay.randevu.dev";
const local = new RandevuLocal({ relayUrl });

// TODO(RDV-13): connect a stdio transport (@modelcontextprotocol/sdk) and expose
// the tools in docs/MCP-API.md over RandevuLocal's methods. For now this is a
// scaffold entrypoint that prints the local identity.
process.stderr.write(
  `[randevu-local ${LOCAL_VERSION}] member ${local.memberId} (${local.did}), relay ${relayUrl}. MCP wiring pending (RDV-13).\n`,
);
