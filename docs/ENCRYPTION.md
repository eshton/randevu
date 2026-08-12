# Encryption & Trust Model

This is the heart of Randevu. The design goal: **the relay is blind, participants are
authenticated, and no party can later deny what their agent said** — all while the only
shared channel between parties is a single out-of-band invite.

## Primitives

All available in **libsodium** (stable, audited, bindings everywhere):

| Purpose                | Primitive                        |
|------------------------|----------------------------------|
| Identity / signatures  | Ed25519                          |
| Key agreement (ECDH)   | X25519                           |
| Key derivation         | HKDF-SHA256                      |
| Content encryption     | XChaCha20-Poly1305 (AEAD)        |
| Key wrapping           | `crypto_box` (X25519 sealed box) |
| Fingerprints           | BLAKE2b (truncated)              |

Each party holds **two** long-term keypairs, generated locally, private halves never leaving
the machine:

- **Identity key** (Ed25519) — signs messages. Its public half's fingerprint *is* the member
  identity.
- **Key-agreement key** (X25519) — receives the wrapped group key.

## Why not the naive single-shared-secret design

Putting one symmetric key in the invite collapses three distinct powers into one leaked
string:

1. **Read** — anyone who intercepts the invite reads everything.
2. **Impersonate** — they can post as either party, undetectably.
3. **No sender proof** — you cannot prove which party wrote which message.

For contracts and money that is unacceptable, so Randevu never does this. Confidentiality,
authorization, and identity are **separated**.

## The handshake

### 1. Create
Party A's local server calls the relay: `create_session(max_members = N)`.
Relay returns `session_id` and a one-time `join_token` (relay stores only its hash).
A posts its **public** identity key and **public** key-agreement key.

### 2. Invite (out-of-band)
A's local server produces an invite string:

```
randevu:<session_id>:<creator_identity_fingerprint>:<join_token>
```

- `creator_identity_fingerprint` — BLAKE2b of A's identity pubkey. A **commitment**, not a
  secret. Its job is anti-MITM.
- `join_token` — one-time **authorization**, not confidentiality. Even if leaked it reveals
  nothing about content and cannot forge signatures.

The human copies this to the counterparty over their own trusted channel.

### 3. Join + anti-MITM check
B's local server:
1. Calls `join_session(session_id, join_token)`.
2. Fetches A's identity pubkey from the relay.
3. **Verifies `BLAKE2b(fetched pubkey) == fingerprint in the invite`.** If the relay tried to
   substitute its own key (MITM), the fingerprint won't match and the join aborts. ✅
4. Posts B's own public keys.
5. Relay marks the token used; when membership satisfies the session rule, the session
   **locks** — no further joiners.

### 4. Group key (multi-party from day one)
Randevu supports 2..N members, so it does **not** rely on a single pairwise ECDH.

- The session creator (or current key-holder) generates a random **group key** `GK` for the
  current **epoch**.
- For each member `m`, it computes `wrapped_m = sealed_box(GK, m.kx_pub)` and posts the
  wrapped copies to the relay (`group_keys` table).
- Each member unwraps `GK` locally with their X25519 private key. The relay only ever holds
  ciphertext-wrapped copies — **blind**. ✅
- **Membership change** → bump epoch, generate a fresh `GK`, rewrap to the new member set.
  (Removing a member means they cannot read messages from the new epoch forward.)

### 5. Messaging
Per message, the sender's local server:

1. `ciphertext = AEAD_encrypt(GK_epoch, nonce, plaintext, associated_data)` where
   `associated_data` binds `session_id`, `epoch`, and sender fingerprint (prevents cross-
   context replay).
2. `signature = Ed25519_sign(identity_priv, transcript_context || ciphertext)`.
3. POST `{session_id, epoch, sender_id, ciphertext, signature}` to the relay, which assigns a
   monotonic `seq`.

Receivers pull new blobs, **verify the signature against the sender's known identity pubkey**,
check the sequence/transcript context, then decrypt with `GK_epoch`.

## Non-repudiation (hard requirement)

Every message is individually signed by the sender's Ed25519 identity key. Because that key's
fingerprint is the member identity, and members' identity pubkeys were pinned at join time:

- A signed message is **cryptographic proof** that the holder of that identity key produced
  exactly that content — no party can later deny their agent agreed to something.
- An **agreement/acceptance** message type lets an agent explicitly sign off on terms; the
  chain of signed messages is a self-contained, verifiable transcript.
- The relay cannot forge signatures (no private keys) and cannot read content, yet the
  transcript is fully provable — **the service guarantees the rail, not the behavior**. If an
  operator's agent signs something unwise, that is a local-configuration failure, not a
  network/service failure. This is intentional: it is exactly what lets both parties trust the
  rail.

### Transcript integrity
Messages are chained: each signature's `transcript_context` includes the running hash of prior
messages (or at least prior `seq` + prev-hash). This stops the relay from **reordering or
dropping** messages without detection — any gap or reorder breaks the chain and every
participant can prove it. (Detection, not prevention: a malicious relay can withhold, but it
cannot do so *silently*.)

## Threat model — what each attacker gets

| Attacker | Capability | Outcome |
|----------|-----------|---------|
| **Relay / DB breach** | Sees all stored data | Ciphertext + public keys only. No plaintext, no private keys. **Blind.** |
| **Invite interceptor** | Has `session_id` + fingerprint + join token | Cannot read (needs a private key), cannot impersonate (cannot forge signatures), cannot hijack (token one-time, session locks). |
| **Active MITM (incl. malicious relay)** | Tries to swap keys | Blocked by fingerprint commitment in the invite. |
| **Malicious relay (transcript tampering)** | Reorders/drops messages | Detectable via the signed transcript chain; cannot be done silently. |
| **Compromised party machine** | Has that party's private keys | Can read/sign as that party. Out of scope — this is local security, the operator's responsibility. |

## Known residuals & their tickets

- **Mutual authentication is TOFU by default.** The invite proves creator→joiner (you sent it).
  Joiner→creator is trust-on-first-use unless upgraded. → **SAS ticket**: both agents compute a
  Short Authentication String from the combined key material and confirm it out-of-band (like
  Signal safety numbers) to close this.
- **Forward secrecy not in v1.** A leaked group key exposes that epoch's history. → ticket:
  per-message hash ratchet, later a Double Ratchet.
- **Metadata visible to relay.** The relay sees *who* is in a session, message counts, timing,
  and sizes (padding can blunt sizes). Content stays private. → ticket: metadata-minimization
  review.
- **Full group standard.** Group-key wrapping is correct and blind but rekeys O(N) on
  membership change. → ticket: evaluate MLS if sessions get large.
