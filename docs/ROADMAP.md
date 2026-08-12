# Roadmap

Ticket backlog lives in Rooster: **Randevu (`RDV`)** project. This file is the phase-level map.

## Phase 0 — Design (current)
- [x] Concept + naming (Randevu)
- [x] Trust model: local encryptor + blind relay
- [x] Encryption protocol drafted (see `ENCRYPTION.md`)
- [x] Lock the stack — see `STACK.md` (TS pnpm monorepo; relay = Cloudflare Workers +
  Durable Objects; crypto = @noble/*; web = Next.js/Vercel)
- [x] Prior-art / interop analysis: ANP + A2A + AP2/x402 — RDV-21; see `INTEROP.md`.
  Outcome: complementary to all; v1 crypto unchanged; 3 seams (DID identity, A2A bridge,
  AP2/x402 settlement) → RDV-29/30/31.
- [x] Scaffold the monorepo (pnpm + Turborepo + Changesets) — RDV-28; build/typecheck/test green
- [ ] Crypto spec review pass (RDV-2) — now incl. did:key + JWS/VC serialization (RDV-29)

## Phase 1 — Blind relay MVP
- Session lifecycle: create / join / lock
- Public-key registry per member
- Append-only encrypted message store + monotonic `seq`
- One-time join tokens (hash-stored) + membership lock
- Poll cursor (`after_seq`)

## Phase 2 — Randevu Local (MCP server)
- Local keypair generation + secure storage (keychain / encrypted file)
- Handshake incl. fingerprint anti-MITM verification
- Group-key generation + wrapping to each member (multi-party from day one)
- AEAD encrypt + Ed25519 sign on send; verify + decrypt on fetch
- Transcript-chain integrity checks
- MCP tools per `MCP-API.md`

## Phase 3 — Non-repudiation hardening
- Signed agreement/accept message types
- `export_transcript` verifiable proof bundle + offline verifier

## Phase 4 — Improvements (deliberately deferred)
- **Push notifications** — SSE / webhook / WebSocket to replace polling
- **SAS mutual auth** — Short Authentication String out-of-band confirmation
- **Forward secrecy** — per-message hash ratchet → Double Ratchet
- **Metadata minimization** — padding, timing review
- **Group scale** — evaluate MLS if sessions grow large

## Open questions (decision tickets)
1. ~~Relay stack~~ — **decided:** Cloudflare Workers + Durable Objects (see `STACK.md`).
2. ~~Local server language~~ — **decided:** TypeScript / Node MCP server.
3. Key storage on the local side — encrypted file (default) vs OS keychain, per platform (RDV-8).
4. Invite format — plain string vs URI vs QR; length budget with fingerprint + token.
5. Session expiry / retention policy for ciphertext blobs.
6. DO topology — one DO per session confirmed; decide sharding/routing + rate-limit strategy.
