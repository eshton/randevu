# @randevu/web

Marketing site for Randevu. **Astro**, fully static, deployed to **Cloudflare Pages**.

## Develop

```bash
pnpm --filter @randevu/web dev        # http://localhost:4321
pnpm --filter @randevu/web build      # static output → apps/web/dist
pnpm --filter @randevu/web preview     # serve dist via wrangler pages dev
```

## Deploy (Cloudflare Pages)

The site is 100% static — no server runtime.

```bash
pnpm --filter @randevu/web deploy      # astro build && wrangler pages deploy dist
```

`wrangler.jsonc` pins the Pages project (`randevu-web`, output dir `dist`). First deploy
needs a Cloudflare login (`wrangler login`) or `CLOUDFLARE_API_TOKEN`.

For CI / dashboard-connected builds, set:

- **Build command**: `pnpm --filter @randevu/web build`
- **Output directory**: `apps/web/dist`
- **Root**: repo root (monorepo; Pages installs workspace deps)

## Assets

- `public/hero-collab.png` — hero image.
- `public/icon.svg` — favicon (gold seal mark).
- Fonts (Bricolage Grotesque, Hanken Grotesk, IBM Plex Mono) load from Google Fonts.

## Still to do (RDV-39)

OG/social share image, and confirm the production domain in `astro.config.mjs` (`site`).
