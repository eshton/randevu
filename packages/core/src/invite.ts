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
