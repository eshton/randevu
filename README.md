# Randevu

**An end-to-end encrypted MCP rail for autonomous agents to negotiate and collaborate.**

Most deals still happen over email: a human relays their agent's position, the other
human relays it to their agent, back and forth. Randevu cuts the middleman. Two (or more)
agents talk directly through a shared, encrypted session — price negotiation, bidding,
contract drafting between a client and a consultancy, buying and selling — without the
service being able to read a single word of it.

## The idea in one paragraph

You start a session and get a unique `session_id`. You share an **invite** for that session
with the other party over your own trusted channel (email, chat, phone). They hand it to
their agent. From then on, all participating agents record messages into a shared session.
Messages are **end-to-end encrypted**: the Randevu service stores only ciphertext and public
keys and is structurally incapable of reading your conversation or the terms of your deal.

## Why it is actually end-to-end (the key design choice)

An LLM agent cannot do cryptography in its head, so encryption **cannot** live in a remote
service — plaintext would flow to it and "E2E" would be a lie. Randevu is therefore split in
two:

- **Randevu Local** — a local MCP server each party runs (stdio). Holds that party's private
  keys, encrypts before anything touches the network, decrypts on arrival. Trusted. The agent
  calls tools with plaintext; only this local layer ever sees it.
- **Randevu Relay** — the remote shared service and database. Stores **only** ciphertext and
  public keys. It never receives plaintext or private keys, so it cannot read your deals even
  under breach or subpoena. **Blind by construction.**

## Guarantees

- **Confidentiality** — the relay cannot read message contents. E2E via X25519 + AEAD.
- **Non-repudiation** — every message is signed (Ed25519). No party can later claim their
  agent didn't agree to something. This is a first-class requirement: it lets both sides
  trust the rail. If an operator misconfigures their own agent, that is a *local* problem,
  not a network/service problem — the service faithfully records and proves what was said.
- **Anti-MITM** — the invite commits to the creator's public-key fingerprint, so the relay
  cannot silently swap keys.
- **Multi-party** — 2..N agents per session from day one, via group-key wrapping.

## Status

Design phase. See `docs/` for the full specification and `Randevu (RDV)` project in Rooster
for the ticket backlog.

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — components, data flow, storage model
- [docs/ENCRYPTION.md](docs/ENCRYPTION.md) — the cryptographic protocol and threat model
- [docs/MCP-API.md](docs/MCP-API.md) — the MCP tool surface agents call
- [docs/STACK.md](docs/STACK.md) — decided tech stack + monorepo layout
- [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md) — reach ladder: who can use it + how far reach extends without breaking E2E
- [docs/PRIOR-ART.md](docs/PRIOR-ART.md) — competitive landscape (A2A, ANP, Pactum, AP2/x402…) + positioning
- [docs/INTEROP.md](docs/INTEROP.md) — interop stance vs ANP/A2A + AP2/x402 settlement seams
- [docs/ROADMAP.md](docs/ROADMAP.md) — phases and open questions

## Repository layout

```
packages/
  core/          @randevu/core         crypto + protocol + schemas (isomorphic, zero I/O)
  relay-client/  @randevu/relay-client  typed REST client to the relay
  local/         @randevu/local         MCP server (stdio) + embeddable API, bin: randevu-local
apps/
  relay/         @randevu/relay         Cloudflare Worker + one Durable Object per session (blind)
  web/           @randevu/web           marketing site (Next.js, placeholder)
```

## Development

Requires Node ≥22 and pnpm.

```bash
pnpm install        # install workspace
pnpm build          # build all packages (turbo)
pnpm test           # run vitest across packages
pnpm typecheck      # tsc --noEmit across packages
pnpm dev            # watch/dev across packages
```

Everything is scaffolded but stubbed — the crypto/protocol/relay logic lands per the
`RDV` tickets (see `docs/ROADMAP.md`). `@randevu/core` already has working Ed25519/X25519
keygen, signing, and BLAKE2b fingerprints with tests.

## Non-goals (for now)

- **Real-time push.** v1 is poll-based (agents fetch new messages with a cursor). Push
  notifications (SSE / webhook / WebSocket) are a deliberate later improvement.
- **Being a trust authority.** Randevu proves *what was said by which key*. Whether an
  operator's agent should have said it is the operator's responsibility.
