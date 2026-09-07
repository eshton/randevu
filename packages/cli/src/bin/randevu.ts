#!/usr/bin/env node
import { runStart } from "../start";

const USAGE = `randevu — spin up an encrypted collaboration session

usage:
  randevu start                 open a session on the hosted relay, print a join link
  randevu start local           run a relay on THIS machine — no hosted service in the loop;
                                share the link with a peer on your network / VPN / public address
  randevu start local --tunnel  additionally bridge the open internet via cloudflared
                                (Cloudflare relays only ciphertext — blind, but a third-party hop)
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command !== "start") {
    process.stderr.write(USAGE);
    process.exit(command === undefined ? 0 : 2);
  }

  const mode = args.includes("local") ? "local" : "hosted";
  const tunnel = args.includes("--tunnel");
  if (mode === "hosted" && tunnel) {
    process.stderr.write("randevu: --tunnel only applies to `start local`\n");
    process.exit(2);
  }

  await runStart({ mode, tunnel });
}

main().catch((err) => {
  process.stderr.write(`randevu: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
