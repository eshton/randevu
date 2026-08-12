# Interoperability Analysis & Stance (RDV-21)

Deep-read of ANP, A2A, AP2, x402 to decide how Randevu relates to the ecosystem before
locking crypto (RDV-2). **Bottom line: Randevu is complementary to all four, and v1 crypto needs
no change** — our X25519 / XChaCha20-Poly1305 / Ed25519 profile is a concrete, compatible
instance of what these leave under-specified, plus a superset (group + non-repudiation).

## What each actually is (verified from specs)

### ANP — Agent Network Protocol (closest sibling)
- **Identity:** `did:wba` (Web-Based Agent DID method, W3C DID). Per-request auth = DID +
  signature in HTTP headers → server returns a bearer token. Keys recommended in TEE/HSM.
- **E2E:** explicitly an **ECDHE** scheme "so intermediate nodes cannot decrypt" — but **primitives
  are undefined** (no curve, AEAD, or KDF named). **Pairwise only** (two DIDs). No group.
- **Relay:** P2P over HTTPS by default, but the whitepaper explicitly anticipates **"renting ports
  from a third-party platform that forwards messages but cannot decrypt them"** — i.e. a **blind
  relay, exactly Randevu's model.**
- **Discovery:** `/.well-known/agent-descriptions` (JSON-LD).
- **No MCP relationship. No multi-party. No formal non-repudiation** (implied by DID signatures).
- **Meta-protocol:** agents negotiate a protocol in natural language and generate code — heavy,
  experimental. **We will not adopt this.**

### A2A — Google Agent2Agent (the interop gorilla)
- **AgentCard** at `/.well-known/agent.json`: capabilities, skills, `securitySchemes`,
  `extensions[]`, and a signed `signature` (JWS).
- **Objects:** `Task`, `Message` (`messageId`, `role`, `parts[]`, `metadata{}`, `extensions[]`),
  `Part` (text / file / data), `Artifact`. Lifecycle: submitted→working→input-required/
  auth-required→completed/failed/canceled/rejected.
- **Transports:** JSON-RPC 2.0/HTTPS, gRPC, REST, SSE, push webhooks.
- **Security: TLS in transit ONLY. Server sees plaintext. No E2E. No message signing** (only the
  AgentCard is signed). No message-level non-repudiation.
- **Extension mechanism:** `AgentExtension {uri, version, required, metadata}`; per-message
  `extensions[]` + `metadata{}`. **This is the seam** — Randevu can ride inside A2A as an extension.

### AP2 — Agent Payments Protocol (settlement, complementary)
- Every purchase = **three signed Mandates** (Intent, Cart, Payment), each a **W3C Verifiable
  Credential signed by the user/agent key**. Explicitly **an extension for A2A and MCP.**
- A Mandate = cryptographically-signed, auditable proof of instruction — **the same shape as our
  signed transcript.** 60+ partners incl. Mastercard/PayPal/Coinbase.

### x402 — HTTP-native payments (settlement, complementary)
- HTTP `402` flow: request → 402 with payment terms → client signs a payment authorization →
  server verifies + settles via a **facilitator** (onchain, USDC). Per-request, stablecoin,
  no accounts. x402 Foundation (Coinbase + Cloudflare).

## Randevu's stance — complement via three seams, compete on none

Randevu is a **confidential negotiation venue**, not an interop standard or a payment rail. It
rides on the others rather than fighting them.

### Seam 1 — Identity: DID-encode our keys (cheap, high option value)
Keep our `@noble` Ed25519 identity keys. **Additionally represent a member's public identity as a
DID** — `did:key` now (self-contained: it just encodes the public key, zero infra), `did:wba`
later if ANP interop matters. Because Ed25519 = **EdDSA**, our signatures serialize directly to
**JWS / W3C VC** with no primitive change. This buys ANP + AP2 (VC) compatibility for ~nothing.
→ affects **RDV-2** (crypto spec) and **RDV-8** (key storage). New ticket filed.

### Seam 2 — Transport: an A2A extension that carries our encrypted envelope
A2A has no E2E and no message signing, so we can't "be A2A" — but we can **traverse A2A while
staying blind**: define a `randevu` A2A extension whose `Message.metadata` carries our
encrypted + signed envelope. An A2A agent that speaks Randevu decrypts it; A2A servers/relays in
the path see only ciphertext in metadata. Publish an AgentCard advertising the capability. This
lets Randevu sessions cross A2A infrastructure without leaking content. → future ticket (bridge).

### Seam 3 — Settlement: emit AP2 Mandates / x402 authorizations from a closed deal
When a negotiation concludes, serialize the agreed terms as an **AP2 Cart/Intent Mandate** (a VC
signed by the member's key — we already sign; just serialize) so the deal plugs into the
Mastercard/PayPal/Coinbase rails. For crypto-native micro-settlement, produce an **x402 payment
authorization** for a facilitator to settle in USDC. **Randevu never touches funds** — it produces
the signed artifact a payment layer consumes. → shapes **RDV-14/15** (agreement types +
transcript should output AP2-compatible signed objects). New ticket filed.

## Crypto: no change to v1 (confirmed)

| Concern | ANP | Randevu | Verdict |
|---|---|---|---|
| Key agreement | "ECDHE" (curve unspecified) | X25519 (ECDHE) | **compatible concrete profile** |
| AEAD | unspecified | XChaCha20-Poly1305 | we specify; valid |
| Signatures | DID sig (alg unspecified) | Ed25519 (= EdDSA, JOSE/VC-standard) | **VC/JWS-serializable** |
| Multi-party | none (pairwise) | group-key wrapping | **superset** |
| Blind relay | anticipated ("forward, cannot decrypt") | core design | **aligned** |
| Non-repudiation | implied | first-class signed transcript | **stronger** |

The only concrete additions are **serialization** choices, not primitive changes:
1. Encode identity pubkeys as `did:key`.
2. Ensure signatures/transcript can be emitted as **JWS / W3C VC** (Ed25519 → EdDSA is standard).

## Explicitly NOT doing
- Not adopting ANP's natural-language meta-protocol codegen (heavy, experimental).
- Not becoming an interop standard or running DID-resolution infra (did:key is self-contained).
- Not handling funds — settlement is emitted, not executed.

## Sources
- ANP whitepaper: https://arxiv.org/html/2508.00007v1 · https://github.com/agent-network-protocol/AgentNetworkProtocol
- A2A spec: https://a2a-protocol.org/latest/specification/ · https://github.com/a2aproject/A2A
- AP2: https://ap2-protocol.org/specification/ · https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol
- x402: https://github.com/x402-foundation/x402 · https://metamask.io/news/what-is-x402
