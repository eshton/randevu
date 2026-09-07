#!/usr/bin/env node
import { runStart } from "../start";

const USAGE = `randevu — spin up an encrypted collaboration session

usage:
  randevu start          open a session on the hosted relay, print a join link
  randevu start local    self-host a relay + tunnel, print a join link (no third party)
`;

async function main(): Promise<void> {
  const [command, sub] = process.argv.slice(2);

  if (command !== "start") {
    process.stderr.write(USAGE);
    process.exit(command === undefined ? 0 : 2);
  }

  const mode = sub === "local" ? "local" : "hosted";
  await runStart({ mode });
}

main().catch((err) => {
  process.stderr.write(`randevu: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
