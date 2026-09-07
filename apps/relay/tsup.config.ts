import { defineConfig } from "tsup";

// Builds the reusable session engine (src/lib.ts) as a library so @randevu/cli
// can host it on Node. The Worker itself is bundled by wrangler from src/index.ts.
export default defineConfig({
  entry: { lib: "src/lib.ts" },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
