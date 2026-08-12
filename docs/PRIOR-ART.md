# Prior Art & Competitive Landscape

Snapshot: 2026-08-12. Revisit before finalizing crypto (RDV-2) and before any positioning/GTM.

**Verdict:** No one occupies Randevu's exact niche — a *blind, MCP-native, E2E venue where two
independent parties' agents negotiate and walk away with a signed, non-repudiable transcript.*
But the surrounding space is crowded and heating fast ("your AI negotiates with their AI" is
explicit 2026 zeitgeist). Randevu is a **product/venue**, not a protocol-war entrant.

## Four buckets

### 1. Interop / communication protocols (plumbing, not a negotiation service)
| Project | What | Crypto posture | Relevance |
|---|---|---|---|
| **Google A2A** (Agent2Agent) | 800-lb gorilla. Linux Foundation, 150+ orgs. HTTP/JSON-RPC 2.0, SSE, AgentCards. | **TLS + OAuth only → server sees plaintext. NOT E2E.** Assumes *known* org boundaries. | Owns interop. Don't fight it — interoperate. |
| **ANP** (Agent Network Protocol) | P2P, open-internet, "HTTP of the agentic web." W3C whitepaper Nov 2025. Ref impl "AgentConnect." | **E2E encryption + W3C DIDs.** Decentralized identity, no central accounts. | **Closest to us on crypto.** The one to watch. |
| **Agora** | Academic (Oxford). | — | Research. |
| **ACP / AGNTCY** | Cisco + LangChain coalition (Agent Connect Protocol). | — | Interop. |
| **AITP** | NEAR Foundation (Agent Interaction & Transaction Protocol). NEAR AI Hub. | — | Has a transaction angle. |
| **Coral** | "Internet of Agents" infra. | — | Orchestration. |
| **MCP** (Anthropic) | Tool-integration protocol; 3-phase session lifecycle, OAuth at transport. | Transport auth, not peer E2E. | Our transport, not a competitor. Note: MCP is designed for short tool calls, *not* multi-turn peer negotiation — Randevu adds the session/negotiation layer on top. |

### 2. Autonomous negotiation apps (shipping, revenue) — one-sided, not neutral
- **Pactum AI** — used by Walmart, Maersk, Vodafone. Millions of supplier negotiations, >60% acceptance, 3–7% extra value.
- **Nibble** — "world's most experienced AI negotiation agent," price discussions.
- **Vertice / Ana** — autonomous vendor-contract negotiation.
- **Microsoft Dynamics 365** — supplier communications agents.

**Key distinction:** these negotiate **on behalf of one side** (procurement) — your-AI-vs-their-human.
None is a **neutral shared rail both sides trust.** That gap is Randevu's.

### 3. Agent payments / commerce (complementary — a settlement hook, not a rival)
- **AP2** (Google Agent Payments Protocol, Sept 2025, 60+ incl Mastercard, PayPal, Amex, Coinbase) — mandate-based, proof-of-intent.
- **x402** (HTTP-native payments; Linux Foundation x402 Foundation, Apr 2026).
- **Skyfire** — agent identity, wallets, spend controls (KYA protocol).
- **Nevermined** — hybrid settlement (fiat/credits/stablecoin); supports x402/MCP/A2A/AP2.

Randevu could **plug one of these in to settle a closed deal** (see interop ticket). Not competitors.

### 4. Adjacent + academic
- **"Agent Relay"** (mcpmarket) — E2E inbox, but agent→**human** delivery of artifacts. Not agent↔agent negotiation.
- **AESP** ([arxiv 2603.00318](https://arxiv.org/pdf/2603.00318)) — theoretical "human-sovereign economic settlement," no MCP, no impl.
- Threat-modeling / survey papers: [MCP/A2A/Agora/ANP security](https://arxiv.org/pdf/2602.11327), [interoperability survey](https://arxiv.org/html/2505.02279v1).

## Where Randevu is genuinely uncontested
1. **Neutral blind venue**, not a one-sided bot. The shared table, not one party's negotiator.
2. **Structural blindness as the product** — relay *cannot* read. A2A is TLS (relay reads plaintext);
   ANP has E2E but is an internet-scale identity protocol, not a drop-in service with a human-shared invite.
3. **MCP-native, zero-integration** — agents get a tool. No AgentCards, no DIDs, no A2A server to stand up.
4. **Non-repudiable signed transcript for arbitrary deals** — not just payment mandates. Our headline; nobody else's.
5. **Human-in-the-trust-loop via out-of-band invite** — "cut the email middleman, but humans still hold the key."

## Risks
- **ANP momentum.** Same crypto instincts (DID + E2E). If it wins, Randevu reads as a simpler, centralized,
  MCP-native alternative. Read its whitepaper before locking crypto.
- **A2A owns interop.** Don't compete on interop — be a confidential *venue* that can carry A2A/MCP messages
  inside encrypted envelopes.
- **Window is open but finite** — the space is 2026's hot topic.

## Actions
- Deep-read **ANP whitepaper** ([arxiv 2508.00007](https://arxiv.org/pdf/2508.00007)) + **AgentConnect**, and **A2A**
  ([github.com/a2aproject/A2A](https://github.com/a2aproject/A2A)) — decide interop stance so we optionally
  interoperate rather than reinvent. (Proposed ticket, ahead of RDV-2.)
- Evaluate **AP2 / x402** as the settlement hook for closed deals.

## Sources
- A2A: https://github.com/a2aproject/A2A · https://galileo.ai/blog/google-agent2agent-a2a-protocol-guide
- ANP: https://github.com/agent-network-protocol/AgentNetworkProtocol · https://arxiv.org/pdf/2508.00007
- Surveys: https://arxiv.org/html/2505.02279v1 · https://arxiv.org/pdf/2602.11327
- Negotiation apps: https://nibbletechnology.com/the-state-of-autonomous-negotiation/ · https://www.vertice.one/platform/ana · https://fullstackrevops.com/articles/the-agentic-negotiation-when-your-ai-sits-across-the-table-from-their-ai
- Payments: https://nevermined.ai/blog/building-agentic-payments-with-nevermined-x402-a2a-and-ap2
