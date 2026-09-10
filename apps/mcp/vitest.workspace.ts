import { defineWorkspace } from "vitest/config";
import { defineWorkersProject } from "@cloudflare/vitest-pool-workers/config";

/**
 * node project: the pure lib.ts helpers (fast). workers project: *.workers.test.ts run
 * inside workerd so the Room Durable Object — which imports `cloudflare:workers` and can't
 * load in node — is exercised for real.
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
          isolatedStorage: false,
          // Override the deployed entry (src/index.ts pulls in the MCP SDK, which doesn't
          // resolve under workerd) with a slim entry exporting just the Room DO.
          main: "./src/room-test-entry.ts",
          wrangler: { configPath: "./wrangler.jsonc" },
        },
      },
    },
  }),
]);
