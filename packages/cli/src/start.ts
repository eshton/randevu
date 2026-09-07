import { RandevuLocal } from "@randevu/local";
import { encodeJoinLink, parseInvite } from "@randevu/core";
import { startNodeRelay, type NodeRelay } from "./node-relay";
import { openTunnel } from "./tunnel";

export interface StartOptions {
  /** "local" self-hosts a relay + tunnel; "hosted" uses the Randevu relay. */
  mode: "local" | "hosted";
  maxMembers?: number;
  /** Writable sink for human output (defaults to process.stdout). */
  out?: { write(s: string): void };
}

const HOSTED_DEFAULT = "https://relay.randevu.dev";

/**
 * `randevu start` — open a session and print a shareable join link.
 *
 * - hosted: create the session on the Randevu relay (or $RANDEVU_RELAY_URL) and exit.
 * - local: boot a blind relay on this machine, tunnel it out, create the session on it,
 *   and keep running so the counterparty can join. No third party in the loop.
 */
export async function runStart(opts: StartOptions): Promise<void> {
  const out = opts.out ?? process.stdout;
  const maxMembers = opts.maxMembers ?? 2;

  let relayUrl: string;
  let relay: NodeRelay | undefined;
  let closeTunnel: (() => void) | undefined;

  if (opts.mode === "local") {
    relay = await startNodeRelay(Number(process.env.RANDEVU_PORT ?? 0));
    out.write(`✓ relay running on ${relay.url}  (in-memory, blind)\n`);
    const tunnel = await openTunnel(relay.port);
    if (tunnel) {
      relayUrl = tunnel.url;
      closeTunnel = tunnel.close;
      out.write(`✓ tunneled to the internet: ${tunnel.url}\n`);
    } else {
      relayUrl = relay.url;
      out.write(
        `! no public tunnel (install cloudflared to expose it) — using ${relay.url}\n`,
      );
    }
  } else {
    relayUrl = process.env.RANDEVU_RELAY_URL ?? HOSTED_DEFAULT;
    out.write(`✓ using hosted relay ${relayUrl}\n`);
  }

  const local = new RandevuLocal({ relayUrl });
  const { sessionId, invite } = await local.createSession(maxMembers);
  const link = encodeJoinLink(relayUrl, parseInvite(invite));

  out.write(`\nsession ${sessionId} ready\n`);
  out.write(`\nshare this link to invite the other party:\n  ${link}\n`);
  out.write(`\npoint your agent's Randevu Local at this relay:\n  RANDEVU_RELAY_URL=${relayUrl}\n`);

  if (opts.mode === "local" && relay) {
    out.write(`\nrelay is serving this session — press Ctrl+C to stop.\n`);
    await waitForShutdown(() => {
      closeTunnel?.();
      void relay!.close();
    });
  }
}

function waitForShutdown(cleanup: () => void): Promise<void> {
  return new Promise<void>((resolve) => {
    const stop = () => {
      cleanup();
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
