import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "bin/randevu-local": "src/bin/randevu-local.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
