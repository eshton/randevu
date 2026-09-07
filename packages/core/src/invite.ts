export interface Invite {
  sessionId: string;
  /** Creator identity fingerprint — a commitment for anti-MITM, not a secret. */
  fingerprint: string;
  /** One-time join token — authorization, not confidentiality. */
  joinToken: string;
}

const PREFIX = "randevu";

/**
 * Encode an out-of-band invite string: `randevu:<sessionId>:<fingerprint>:<joinToken>`.
 * The human relays this to the counterparty over their own trusted channel.
 */
export function encodeInvite(invite: Invite): string {
  for (const [key, value] of Object.entries(invite)) {
    if (!value || value.includes(":")) {
      throw new Error(`invalid invite field: ${key}`);
    }
  }
  return [PREFIX, invite.sessionId, invite.fingerprint, invite.joinToken].join(":");
}

/** Parse and validate an invite string. Throws on malformed input. */
export function parseInvite(input: string): Invite {
  const parts = input.trim().split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("malformed invite");
  }
  const [, sessionId, fingerprint, joinToken] = parts;
  if (!sessionId || !fingerprint || !joinToken) {
    throw new Error("malformed invite");
  }
  return { sessionId, fingerprint, joinToken };
}

/** An invite plus the relay endpoint it should be joined against. */
export interface JoinLink {
  relayUrl: string;
  invite: Invite;
}

/**
 * Encode a shareable https join link:
 * `https://<relay-host>/j/<sessionId>#<fingerprint>.<joinToken>`.
 *
 * The join token (a secret) lives in the URL **fragment**, which browsers never
 * send to a server — so the link can be handed over in the clear. The fingerprint
 * is a public anti-MITM commitment. Unlike the bare invite string, a link also
 * carries which relay to talk to, so the counterparty needs no out-of-band config.
 */
export function encodeJoinLink(relayUrl: string, invite: Invite): string {
  if (!invite.sessionId || /[/?#]/.test(invite.sessionId)) {
    throw new Error("invalid invite field: sessionId");
  }
  if (!invite.fingerprint || invite.fingerprint.includes(".")) {
    throw new Error("invalid invite field: fingerprint");
  }
  if (!invite.joinToken || invite.joinToken.includes(".")) {
    throw new Error("invalid invite field: joinToken");
  }
  // Reduce the relay URL to its origin (scheme://host[:port]); no URL global — core is DOM-free.
  const origin = relayUrl.trim().match(/^(https?:\/\/[^/?#]+)/i)?.[1];
  if (!origin) throw new Error("invalid relay url");
  return `${origin}/j/${invite.sessionId}#${invite.fingerprint}.${invite.joinToken}`;
}

/** Parse a join link back into its relay endpoint + invite. Throws on malformed input. */
export function parseJoinLink(link: string): JoinLink {
  const m = link.trim().match(/^(https?:\/\/[^/?#]+)\/j\/([^/?#]+)#(.+)$/i);
  if (!m) throw new Error("malformed join link");
  const relayUrl = m[1]!;
  const sessionId = decodeURIComponent(m[2]!);
  const frag = m[3]!;
  const dot = frag.indexOf(".");
  if (dot < 1) throw new Error("malformed join link");
  const fingerprint = frag.slice(0, dot);
  const joinToken = frag.slice(dot + 1);
  if (!sessionId || !fingerprint || !joinToken) throw new Error("malformed join link");
  return { relayUrl, invite: { sessionId, fingerprint, joinToken } };
}
