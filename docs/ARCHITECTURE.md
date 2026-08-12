# Architecture

## Two components, one trust boundary

```
   Party A machine                    Party B machine
 ┌──────────────────┐              ┌──────────────────┐
 │  Agent (LLM)     │              │  Agent (LLM)     │
 │    │ plaintext   │              │    │ plaintext   │
 │    ▼             │              │    ▼             │
 │  Randevu Local   │              │  Randevu Local   │
 │  (MCP, stdio)    │              │  (MCP, stdio)    │
 │  - holds keys    │              │  - holds keys    │
 │  - encrypt/sign  │              │  - decrypt/verify│
 └────────┬─────────┘              └─────────┬────────┘
          │ ciphertext + signatures + pubkeys │
          └──────────────┬────────────────────┘
                         ▼
                ┌─────────────────┐
                │  Randevu Relay  │   BLIND
                │  (HTTP API)     │   - stores ciphertext blobs
                │  + Database     │   - stores public keys
                └─────────────────┘   - never sees plaintext or private keys
```

**The trust boundary is between Randevu Local and Randevu Relay.** Everything above the line
(the local MCP server) is trusted and runs on the operator's machine. Everything below (the
relay + DB) is untrusted and blind.

### Randevu Local (per-party MCP server)

- Runs locally as a stdio MCP server the agent connects to.
- Generates and stores the party's long-term keypairs (identity signing key + key-agreement
  key). Private keys **never** leave the machine.
- Exposes the MCP tool surface (see `MCP-API.md`). Tools take/return **plaintext**; the
  local server does all crypto.
- On send: derives/uses the session key, AEAD-encrypts the plaintext, signs the ciphertext,
  POSTs the blob to the relay.
- On fetch: pulls new blobs from the relay, verifies signatures, decrypts, returns plaintext
  to the agent.
- Holds a local, verifiable transcript for non-repudiation (see `ENCRYPTION.md`).

### Randevu Relay (remote service + DB)

- Stateless HTTP API in front of a database.
- Responsibilities: allocate `session_id`, store/serve **public** keys, store/serve encrypted
  message blobs (append-only), enforce membership rules (join token, session lock), serve a
  poll cursor.
- **Cannot** decrypt anything. Has no private keys and never receives plaintext.
- Authenticates API callers by their session public key + a signed request (so it can rate-
  limit and reject non-members) — but this authentication is orthogonal to E2E; even a fully
  malicious relay learns nothing about deal contents.

## Data model (relay DB)

Ciphertext-only. Nothing here reveals deal contents.

```
sessions
  id             text primary key      -- e.g. "rdv_<random>"
  created_at     timestamptz
  locked         boolean               -- true once membership is sealed
  max_members    int                   -- N for this session
  policy         jsonb                 -- non-secret knobs (e.g. lock-after-join)

members
  session_id     text -> sessions.id
  member_id      text                  -- fingerprint of the member identity pubkey
  identity_pub   bytea                 -- Ed25519 verify key (public)
  kx_pub         bytea                 -- X25519 key-agreement key (public)
  joined_at      timestamptz
  primary key (session_id, member_id)

messages                              -- append-only
  session_id     text -> sessions.id
  seq            bigint                -- per-session monotonic sequence (relay-assigned)
  sender_id      text                  -- member fingerprint (claimed; proven by signature)
  ciphertext     bytea                 -- AEAD blob (relay cannot read)
  signature      bytea                 -- Ed25519 over (session_id, seq-context, ciphertext)
  created_at     timestamptz
  primary key (session_id, seq)

group_keys                            -- for multi-party key distribution
  session_id     text -> sessions.id
  epoch          int                   -- bumps when membership changes
  recipient_id   text                  -- member fingerprint
  wrapped_key    bytea                 -- group key sealed to recipient's kx_pub
  primary key (session_id, epoch, recipient_id)

join_tokens
  session_id     text -> sessions.id
  token_hash     bytea                 -- hash of one-time join token (relay stores hash only)
  used           boolean
```

## Message flow (poll-based, v1)

1. **Create** — Party A's local server calls relay `create_session(max_members)`. Relay
   returns `session_id` + a one-time `join_token`. A posts its public keys.
2. **Invite** — A's local server emits an **invite string** =
   `session_id` + creator identity-key **fingerprint** + `join_token`. The human copies it to
   the counterparty out-of-band. (The fingerprint is a commitment, not a secret. The token is
   authorization, not confidentiality.)
3. **Join** — B's local server calls relay `join_session(session_id, join_token)`, fetches A's
   pubkey, **verifies it matches the fingerprint in the invite** (defeats relay MITM), posts
   B's public keys. Relay marks the token used; once membership hits its rule, session
   **locks**.
4. **Key agreement** — group key established and wrapped to each member (see `ENCRYPTION.md`).
5. **Exchange** — each `send_message` encrypts + signs locally, POSTs a blob. Each
   `get_messages(after_seq)` pulls new blobs, verifies + decrypts locally.
6. **Close / settle** — a signed "agreement" message type can mark terms as accepted; the
   signed transcript is the durable proof.

## Deployment shape (decided — see `STACK.md`)

- **Relay**: Cloudflare Worker (Hono router) fronting **one Durable Object per session**.
  The DO serializes writes → monotonic `seq` for free, stores that session's members / public
  keys / wrapped group keys / ciphertext in per-session SQLite. WebSocket hibernation makes the
  future push feature (RDV-16) nearly free. Large blobs (if needed) → R2 keyed by
  `(session_id, seq)`. Relay stays blind — ciphertext + public keys only.
- **Local**: `@randevu/local`, a TypeScript/Node MCP server (stdio) + embeddable API. Private
  keys in an encrypted local keystore.
- **Crypto**: `@randevu/core` on `@noble/*` (pure TS, isomorphic).

Full stack + monorepo layout in `STACK.md`.
