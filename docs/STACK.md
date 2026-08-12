# Stack (decided)

Decided 2026-08-12. TypeScript everywhere, one pnpm monorepo.

## Monorepo

```
randevu/                      pnpm workspace + Turborepo + Changesets
  packages/
    core/          @randevu/core         crypto + protocol + Zod schemas + types.
                                         Isomorphic, zero I/O. Unit-tested with vectors.
                                         Reusable (astonagent can import it).
    relay-client/  @randevu/relay-client  typed REST client to the relay. Deps core.
    local/         @randevu/local         MCP server (stdio) + embeddable API.
                                         bin: `randevu-local`. Deps core + relay-client.
  apps/
    relay/                               Cloudflare Worker + Durable Objects (blind).
    web/                                marketing site (Next.js on Vercel).
```

- **Package manager / orchestration:** pnpm workspaces + **Turborepo** (task cache) + **Changesets** (version + publish `@randevu/*` to npm). **tsup** per package.
- **Validation:** **Zod** schemas defined in `core`, shared by MCP tool inputs and the relay API boundary. Types derived from schemas.
- **Testing:** **Vitest** across all packages. Crypto = published test vectors + round-trip. Relay = miniflare/`wrangler dev`.

## Crypto — @noble/\*

Pure TS, audited, zero-dep, isomorphic, no WASM init.

| Purpose            | Package / fn                                  |
|--------------------|-----------------------------------------------|
| Signatures         | `@noble/curves/ed25519` (ed25519)             |
| Key agreement      | `@noble/curves/ed25519` (x25519)              |
| Content AEAD       | `@noble/ciphers/chacha` (xchacha20poly1305)   |
| KDF                | `@noble/hashes/hkdf` + `sha256`               |
| Fingerprints       | `@noble/hashes/blake2b`                       |

We implement the **sealed-box** (anonymous encrypt-to-pubkey for group-key wrapping) ourselves
on top of x25519 + xchacha20poly1305 (~30 lines): ephemeral X25519 keypair → ECDH →
HKDF → AEAD, prepend ephemeral pubkey. Documented in `ENCRYPTION.md`.

## Relay — Cloudflare Workers + Durable Objects

**One Durable Object per session.** This is the core structural choice:

- **Serialized writes** inside the DO → monotonic `seq` for free (no row locks, no sequence
  contention). The append-only log is naturally ordered.
- **Per-session SQLite** (DO storage) holds that session's members, public keys, wrapped
  group keys, and ciphertext messages. Isolation per deal.
- **WebSocket hibernation** → the future push ticket (RDV-16) is nearly free: agents subscribe
  to their session's DO, get notified on append, no separate pub/sub infra.
- **Hono** router on the Worker in front, routing `/sessions/:id/*` to the right DO stub.
- Large blobs (if ever needed) → **R2**, keyed by `(session_id, seq)`.

Still **blind**: the DO stores only ciphertext + public keys. Cloudflare cannot read deals.

**Relay request auth** (orthogonal to E2E): callers sign requests with their session identity
key so the DO can reject non-members and rate-limit. Even a fully malicious relay learns
nothing about content.

- **Dev:** `wrangler dev` / miniflare.
- **Config:** `wrangler.jsonc`.

## Marketing web — Next.js on Vercel

Next.js 16 App Router + Tailwind CSS 4 + shadcn/ui, deployed on Vercel. Content in MDX.

## Local key storage

Encrypted JSON keystore (scrypt-derived key / age-style wrap) — portable, works headless,
which an MCP server needs. Native OS keychain (`@napi-rs/keyring`) optional per platform.
(keytar is unmaintained — not used.) Detail in RDV-8.

## npm scope

Publish under `@randevu/*`. Needs the npm org `randevu` reserved.
