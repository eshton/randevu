# Distribution & Reach

Who can actually use Randevu, and how far can reach extend without breaking the E2E promise.

## Two user segments → two tiers of one core

The whole reach question resolves into **two kinds of user**, which map to two product tiers
built on the same `@randevu/core`:

**Segment 1 — Sovereign / zero-trust.** Won't hand plaintext to *any* hosted brain — no ChatGPT,
no hosted anything. Runs local or self-hosted agents. Needs local tools + **structural**
blindness. They don't want *reassurance*, they want to **verify** ("don't trust, verify"):
open-source `@randevu/core`, auditable no-key-egress, ideally a **self-hostable relay**.
Reputation is worthless to them; math and source are everything.

**Segment 2 — Pragmatic-trust.** Already trust OpenAI/Anthropic with their data, so Randevu is
just *one more vendor to trust*. Doesn't need cryptographic blindness — needs the normal SaaS
trust playbook: no-plaintext-logging policy, encryption at rest, SOC2, ZDR, audits, reputation.
Hosted connector is fine.

| | **Segment 1 — Sovereign** | **Segment 2 — Pragmatic** |
|---|---|---|
| Product | Randevu Local (lib + stdio MCP, self-hostable relay) | Randevu Cloud (hosted connector) |
| Guarantee | **structural** — relay *cannot* read | **policy** — Randevu *will not* read |
| Wins them | open source, verifiable, no egress | SOC2, ZDR, no-log policy, reputation |
| Reaches | local-agent devs, high-stakes deals (legal, M&A) | ChatGPT / web users, prosumer / SMB |
| Rungs | 1–3 | 4c (+ optional 4a TEE) |

**Why this works:** the sovereign tier is the **credibility anchor** for the hosted tier. Because
the blind core is real, open, and auditable, Segment 2's "you can trust us" becomes *believable* —
point at the tier where we provably can't cheat. Ship a custodian tier with no blind tier behind
it and it's just another SaaS asking for faith. **The blind core is the brand; never dilute it.**

**Thin middle (keep in a drawer):** users who trust OpenAI with the *brain* but not Randevu with
*storage* — exactly who TEE/4a serves (hosted convenience + attestable blindness). Real, niche,
not a launch priority.

## The fundamental tension

True "the service can **never** read your deal" requires the **private key + the
encrypt/decrypt step to live outside the relay's trust boundary** — i.e. on hardware the
participant controls. That is the whole reason for the Randevu Local / Randevu Relay split.

So there is an unavoidable tradeoff: **reach ⟂ trust.** The easier it is for a zero-install,
hosted agent (ChatGPT web) to use Randevu, the more likely the encryptor runs on infrastructure
that isn't strictly the participant's own — which weakens "we literally cannot read it."

The answer is a **reach ladder**: several form-factors of the *same* `@randevu/core`, each a
different point on the reach-vs-trust curve. Every rung shares one property: **the relay stays
blind.** The rungs differ only in *where the participant's key lives* and *who could, in the
worst case, see plaintext before it is encrypted.*

## The reach ladder

### Rung 1 — Embeddable library (`@randevu/core`)  ·  strongest trust
Any custom TS/JS agent imports it: **astonagent**, Vercel AI SDK agents, Mastra, LangChain-JS,
etc. Keys live wherever that app runs (the operator's own process). E2E fully intact.
**Audience:** developers building their own agents. **Status:** v1 core.

### Rung 2 — Local MCP server (`@randevu/local`, stdio)  ·  strongest trust
Drop-in for MCP *desktop* clients: **Claude Desktop, Claude Code, Cursor, Cline, Windsurf**, any
client that can spawn a local stdio server. Keys fully local, headless. E2E fully intact.
**Audience:** people running agents on their own machine. **Status:** v1 (RDV-8..13).

> Rungs 1–2 are the honest, no-caveats E2E. But they only reach people running agents locally.

### Rung 3 — Browser SDK / extension  ·  strong trust
`@randevu/core` compiled for the browser (it's pure TS/@noble, no WASM init — already
isomorphic). Keys in **IndexedDB / WebCrypto non-extractable keys**, encryption in the user's
own browser tab. E2E preserved because the browser ≠ the relay.
- As a **Randevu web app**: a human (or a lightweight in-page agent) drives a session from a
  browser. Good for the "I don't run a local agent" user.
- As a **browser extension companion**: holds keys and encrypts on behalf of a web agent in the
  *same* browser.
**Audience:** web users, no install (or one extension). **Status:** ticket.

### Rung 4 — Hosted remote MCP connector  ·  max reach, relaxed trust  ← the ChatGPT-web path
Hosted agents like **ChatGPT, Claude web, Gemini** cannot spawn a local process. They can only
attach a **remote MCP connector / tool**. A remote MCP server *we* host would, naively, see
plaintext before encrypting → that breaks "Randevu-the-company can't read it" (though the
*relay* and the *counterparty* still can't).

Three ways to handle Rung 4, best-to-worst on trust:

- **4a. TEE / confidential-computing encryptor (recommended if we do this).** Host the
  per-user encryptor inside a hardware enclave (AWS Nitro Enclaves, Azure Confidential, GCP
  Confidential Space). Keys are generated and used *inside* the enclave; even Randevu operators
  cannot read plaintext or extract keys, and users can attest the enclave. This restores a
  strong (attestable) E2E-like guarantee for zero-install web agents. Complexity: high. R&D.
- **4b. User-controlled companion.** The web agent drafts plaintext, but a **separate
  user-held component** (Rung 3 browser extension, or a local sidecar) does the actual
  encryption before anything reaches Randevu. Keeps true E2E, but needs the user to install the
  companion — so not truly zero-install.
- **4c. Trusted-custodian (explicit downgrade).** We host a plain per-user encryptor, keys held
  only in the authenticated session, no plaintext logging — but the user must *trust Randevu*.
  Only acceptable if clearly labeled; **not** the "structurally blind" promise. Avoid as the
  default; offer only as an opt-in convenience tier if ever.

### Rung 5 — REST + non-JS ecosystems (Python, Go, …)
Python agents (LangChain, CrewAI, custom) can't import a TS lib. Options: a **Python port of
`@randevu/core`**, or a **local sidecar** (Rung 2 process they call over localhost), or a thin
FFI/WASM binding. Keys stay on their machine → E2E intact. **Status:** ticket (Python port vs
sidecar decision).

## Who each participant must trust (the trust chain)

"E2E" means the *endpoints are the two agents* — and an agent must **read** the negotiation to
negotiate, so plaintext is inherently visible wherever that agent's **brain (model) runs**. This
is true at **every rung, including local**. Randevu's blindness protects content from the
**relay, network/storage, and the counterparty's infrastructure** — never from your *own*
agent's model provider.

So there are two independent trust questions:
1. **Who runs my agent's brain?** — always sees my plaintext. Chosen when you pick ChatGPT vs
   local Claude vs self-hosted. Randevu-independent. (Reducible via self-hosted model / ZDR tier —
   the operator's local config, not the network's job.)
2. **Does Randevu also see my plaintext?** — the only thing the rungs vary.

| Rung | Who sees your plaintext | New party trusted *beyond your model provider* |
|---|---|---|
| 1–2 local / 3 browser | your model provider only | **none** |
| 4a TEE enclave | your model provider only (attestable) | **none** |
| 4c custodian | model provider **+ Randevu** | **Randevu** |

Takeaway: using ChatGPT already means trusting OpenAI with the plaintext — custodian or not. The
*only new* trust a hosted Randevu adds is trust in **Randevu**, and TEE (4a) removes even that.

## Mixed-trust sessions are fine (and important)

A session can mix rungs: Party A on a local MCP server (Rung 2, airtight), Party B on a hosted
connector (Rung 4). This works — **each participant's security equals where *their own* key
lives.** The **non-repudiation guarantee is unaffected**: every message is still signed by the
sender's key, so the signed transcript is valid regardless of rung. The only thing that varies
per participant is the exfiltration risk of *their* plaintext before signing — which is *their*
choice of rung. Randevu should **surface each member's rung/trust level** in `session_status`
so a counterparty knows whether they're negotiating against a locally-held or hosted key.

## Recommendation

- **v1:** Rungs 1 + 2 (lib + local MCP). Honest, uncompromised E2E. Ship the wedge.
- **Fast follow:** Rung 3 (browser SDK) — unlocks web users while keeping true E2E; low cost
  since core is already isomorphic.
- **R&D / demand-gated:** Rung 4a (TEE encryptor) to reach ChatGPT-web-class agents *without*
  fully abandoning the blindness promise. Only pursue if there's real pull; it's the expensive,
  complex rung. Never ship 4c as the default.
- **When Python demand appears:** Rung 5 (port vs sidecar).

Reach grows outward from a trustworthy core; we never let reach quietly downgrade the core
promise. Any rung that relaxes "we cannot read it" must say so in plain language.
