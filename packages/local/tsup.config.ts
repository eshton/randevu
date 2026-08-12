import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "bin/randevu-local": "src/bin/randevu-local.ts",
    "bin/randevu-verify": "src/bin/randevu-verify.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
