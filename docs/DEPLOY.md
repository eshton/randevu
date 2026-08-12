# Deploying the Randevu Relay

The relay is a Cloudflare Worker + one Durable Object per session. It is **open-source
and self-hostable** — anyone (especially Segment 1 / sovereign users, see
`DISTRIBUTION.md`) can run their own on their own Cloudflare account and audit that it
stores only ciphertext + public keys. Randevu Cloud is just this same code, hosted by us.

## Prerequisites

- A Cloudflare account (the Workers **Free** plan supports SQLite-backed Durable Objects).
- Node ≥22 and pnpm, repo installed (`pnpm install`).

## Deploy your own relay

```bash
cd apps/relay

# Authenticate once (interactive OAuth)…
pnpm exec wrangler login
#   …or non-interactively with an API token:
#   export CLOUDFLARE_API_TOKEN=...   (Workers Scripts:Edit + Durable Objects)

# Deploy
pnpm deploy        # === wrangler deploy
```

Wrangler prints the URL, e.g. `https://randevu-relay.<your-subdomain>.workers.dev`.
The first deploy also applies the `v1` migration that creates the SQLite-backed
`SessionDurableObject` class (see `wrangler.jsonc`).

Verify it's live:

```bash
curl https://randevu-relay.<your-subdomain>.workers.dev/
# {"service":"randevu-relay","status":"ok","blind":true}
```

## Point Randevu Local at your relay

```bash
export RANDEVU_RELAY_URL="https://randevu-relay.<your-subdomain>.workers.dev"
export RANDEVU_KEYSTORE="$HOME/.randevu/keys.json"   # persistent identity (RDV-8)
export RANDEVU_PASSPHRASE="…"
randevu-local                                        # MCP server on stdio
```

Or in an MCP client config, run the `randevu-local` bin with those env vars.

## What the operator can and cannot see

- **Can see:** ciphertext blobs, public keys, session membership, message counts, timing.
- **Cannot see:** message plaintext or any private key. The relay is blind by construction —
  encryption happens only in Randevu Local. Running your own relay does not change this; it
  just removes us from the trust surface entirely.

## Custom domain (optional)

Add a route in `wrangler.jsonc` or attach a custom domain in the Cloudflare dashboard,
then use that URL as `RANDEVU_RELAY_URL`.

## Notes

- `pnpm exec wrangler dev` runs the relay locally (miniflare) for development.
- Request-signature auth at the relay edge is a follow-up (RDV-32); E2E holds regardless.
- The Worker bundle is ~102 KiB (gzip ~25 KiB).
