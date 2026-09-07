import { networkInterfaces } from "node:os";
import { RandevuLocal } from "@randevu/local";
import { encodeJoinLink, parseInvite } from "@randevu/core";
import { startNodeRelay, type NodeRelay } from "./node-relay";
import { openTunnel } from "./tunnel";

export interface StartOptions {
  /** "local" self-hosts a relay on this machine; "hosted" uses the Randevu relay. */
  mode: "local" | "hosted";
  /** local only: bridge to the open internet via a cloudflared tunnel (a blind Cloudflare hop). */
  tunnel?: boolean;
  maxMembers?: number;
  /** Writable sink for human output (defaults to process.stdout). */
  out?: { write(s: string): void };
}

const HOSTED_DEFAULT = "https://relay.randevu.dev";

/**
 * `randevu start` — open a session and print a shareable join link.
 *
 * - hosted: create the session on the Randevu relay (or $RANDEVU_RELAY_URL) and exit.
 * - local: run a blind relay on this machine — no hosted service in the loop. It advertises
 *   a directly-reachable address (LAN / $RANDEVU_HOST) so a peer on the same network, VPN, or
 *   public address can join with nothing in between. Pass `tunnel` to bridge the open internet
 *   via cloudflared (which then carries your ciphertext — blind, but a third party in the path).
 */
export async function runStart(opts: StartOptions): Promise<void> {
  const out = opts.out ?? process.stdout;
  const maxMembers = opts.maxMembers ?? 2;

  let relayUrl: string;
  let relay: NodeRelay | undefined;
  let closeTunnel: (() => void) | undefined;

  if (opts.mode === "local") {
    // Bind all interfaces so a peer on this network can reach it; advertise a routable host.
    relay = await startNodeRelay(Number(process.env.RANDEVU_PORT ?? 0), "0.0.0.0");
    const advertised = process.env.RANDEVU_HOST ?? lanAddress() ?? "127.0.0.1";
    relayUrl = `http://${advertised}:${relay.port}`;
    out.write(`✓ relay running on this machine — no hosted service in the loop\n`);

    if (opts.tunnel) {
      const tunnel = await openTunnel(relay.port);
      if (tunnel) {
        relayUrl = tunnel.url;
        closeTunnel = tunnel.close;
        out.write(`✓ bridged to the internet via cloudflared: ${tunnel.url}\n`);
        out.write(`  (Cloudflare relays the ciphertext — it can't read it, but it is a hop.)\n`);
      } else {
        out.write(
          `! cloudflared not available — staying fully local. Install it to bridge the internet:\n` +
            `    macOS:  brew install cloudflared\n` +
            `    other:  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/\n`,
        );
      }
    }

    if (!opts.tunnel || relayUrl.startsWith("http://")) {
      out.write(`  reachable at ${relayUrl}\n`);
      if (advertised === "127.0.0.1" && !opts.tunnel) {
        out.write(
          `  (that address only works on this machine — put it on a shared network/VPN,\n` +
            `   set RANDEVU_HOST=<your address>, or add --tunnel to cross the internet)\n`,
        );
      }
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

/** First non-internal IPv4 — a LAN address a peer on the same network can reach. */
function lanAddress(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal) return ni.address;
    }
  }
  return undefined;
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
