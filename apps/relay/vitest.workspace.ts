import { defineWorkspace } from "vitest/config";
import { defineWorkersProject } from "@cloudflare/vitest-pool-workers/config";

/**
 * Two projects: the fast node project runs the pure logic tests (Session, dispatch,
 * store, auth, e2e) as before; the workers project runs *.workers.test.ts INSIDE workerd
 * (miniflare), the only place the Durable Object `fetch` shell can actually execute.
 */
export default defineWorkspace([
  {
    test: {
      name: "node",
      include: ["src/**/*.test.ts"],
      exclude: ["src/**/*.workers.test.ts"],
    },
  },
  defineWorkersProject({
    test: {
      name: "workers",
      include: ["src/**/*.workers.test.ts"],
      poolOptions: {
        workers: {
          // Each test uses a unique DO name, so per-test storage isolation (which asserts
          // on a stacked-storage teardown that's fragile here) isn't needed.
          isolatedStorage: false,
          wrangler: { configPath: "./wrangler.jsonc" },
        },
      },
    },
  }),
]);
