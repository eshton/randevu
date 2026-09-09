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

/** An invite plus the relay endpoint it should be joined against (and optional room kind). */
export interface JoinLink {
  relayUrl: string;
  invite: Invite;
  kind?: string;
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
export function encodeJoinLink(relayUrl: string, invite: Invite, kind = ""): string {
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
  // The join token (secret) + the fingerprint (public commitment) + kind ride in the
  // fragment, which browsers never send to a server — so the token stays out of server logs.
  const frag = `${invite.fingerprint}.${invite.joinToken}${kind ? `.${encodeURIComponent(kind)}` : ""}`;
  return `${origin}/j/${invite.sessionId}#${frag}`;
}

/** Parse a join link back into its relay endpoint + invite (+ kind). Throws on malformed input. */
export function parseJoinLink(link: string): JoinLink {
  const m = link.trim().match(/^(https?:\/\/[^/?#]+)\/j\/([^/?#]+)#(.+)$/i);
  if (!m) throw new Error("malformed join link");
  const relayUrl = m[1]!;
  const parts = m[3]!.split(".");
  const fingerprint = parts[0] ?? "";
  const joinToken = parts[1] ?? "";
  // decodeURIComponent throws on malformed %-escapes — normalize to a single error.
  let sessionId: string;
  let kind: string | undefined;
  try {
    sessionId = decodeURIComponent(m[2]!);
    kind = parts.length > 2 ? decodeURIComponent(parts.slice(2).join(".")) : undefined;
  } catch {
    throw new Error("malformed join link");
  }
  if (!sessionId || !fingerprint || !joinToken) throw new Error("malformed join link");
  return { relayUrl, invite: { sessionId, fingerprint, joinToken }, ...(kind ? { kind } : {}) };
}
