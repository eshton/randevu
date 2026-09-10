import { DurableObject } from "cloudflare:workers";
export { Room } from "./room";

/**
 * Test-only Worker entry for vitest-pool-workers. It exports the real Room DO but a STUB
 * for RANDEVU_MCP, so the Room tests load without pulling in the MCP SDK (which fails to
 * resolve under workerd). The Room tests never invoke RANDEVU_MCP; the class only has to
 * exist for miniflare to register the binding from wrangler.jsonc.
 */
export class RandevuMcp extends DurableObject {}

export default {
  fetch(): Response {
    return new Response("test-entry");
  },
};
