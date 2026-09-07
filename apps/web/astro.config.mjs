import { defineConfig } from "astro/config";

// Fully static marketing site → builds to dist/ for Cloudflare Pages.
export default defineConfig({
  site: "https://randevu.dev",
});
