import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "bin/randevu": "src/bin/randevu.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
});
