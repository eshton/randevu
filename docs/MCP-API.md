# MCP Tool Surface

These are the tools **Randevu Local** exposes to the agent. The agent always works in
**plaintext**; the local server does every cryptographic operation before/after the network.
Tool names are provisional.

## `randevu_create_session`
Start a new session.

- **In**: `max_members` (int, ≥2), optional `policy` (e.g. `lock_after_join: true`).
- **Does**: generates local keypairs if absent; calls relay to allocate `session_id` + a
  one-time join token; posts this party's public keys.
- **Out**: `session_id`, and a human-shareable **`invite`** string
  (`randevu:<session_id>:<fingerprint>:<join_token>`).
- **Agent guidance**: return the `invite` to the human to send to the counterparty
  out-of-band. Do not post it into any untrusted channel.

## `randevu_join_session`
Join a session from an invite.

- **In**: `invite` (the string from the other party).
- **Does**: parses the invite; calls relay `join_session`; **fetches the creator's pubkey and
  verifies it against the fingerprint in the invite** (aborts on mismatch — possible MITM);
  posts this party's public keys; unwraps the group key.
- **Out**: `session_id`, `members` (list of fingerprints), `verified: true`.

## `randevu_send_message`
Send an encrypted, signed message into the session.

- **In**: `session_id`, `body` (plaintext), optional `type`
  (`message` | `offer` | `counter` | `accept` | `reject`).
- **Does**: AEAD-encrypts with the current group key, Ed25519-signs, POSTs the blob.
- **Out**: `seq` (assigned position), `signed: true`.

## `randevu_get_messages`
Fetch and decrypt new messages (poll).

- **In**: `session_id`, `after_seq` (cursor; default 0).
- **Does**: pulls new blobs; **verifies every signature**; checks transcript-chain integrity;
  decrypts.
- **Out**: list of `{seq, sender_id, type, body, verified, signed_at}`; new cursor.
- **Note**: any signature/chain failure is surfaced loudly — it means tampering or a
  misbehaving relay, never silent.

## `randevu_session_status`
- **In**: `session_id`.
- **Out**: `members`, `locked`, `epoch`, `message_count`, `last_seq`.

## `randevu_export_transcript`
Produce the portable, verifiable proof bundle.

- **In**: `session_id`.
- **Out**: the ordered signed messages + members' identity pubkeys — a self-contained artifact
  anyone can verify offline for non-repudiation (who signed what, in what order).

## Deferred (future tickets)
- `randevu_verify_sas` — confirm a Short Authentication String out-of-band for full mutual auth.
- Push delivery — replace polling with SSE/webhook/WebSocket so `get_messages` isn't needed.

## Agreements (RDV-14)

Every message carries a stable **content-id** (`id`, hex of its canonical signing bytes),
returned by `randevu_get_messages`. To sign off on specific terms, send an `accept` whose
**`ref`** is that id (`randevu_send_message` accepts `ref`; the `accept`/`reject`/`counter`
helpers on the embeddable API take it directly). The `ref` is part of the signed envelope, so
acceptance is bound to the exact terms — not a bare "I accept".

`verifyTranscript` (and `randevu_export_transcript`) surface a derived **`agreements`** list:
each verified `accept` resolved to `{ accepter, acceptsId, acceptedSenderId, acceptedBody }` —
cryptographic proof of who agreed to what.

## Design rules
- Tools take/return plaintext; **crypto never leaks into the agent's context**.
- Private keys are never an input or output of any tool.
- The `invite` is the only thing the human relays, and it is safe to send over a channel the
  parties already trust.
