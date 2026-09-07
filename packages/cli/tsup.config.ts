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
  // @randevu/relay is the Worker app (not published to npm), so inline its session
  // engine into the CLI. Published deps (@randevu/core, @randevu/local, @noble/hashes)
  // stay external and resolve normally.
  noExternal: ["@randevu/relay"],
});
