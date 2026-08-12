import { describe, it, expect } from "vitest";
import app from "./index";

describe("@randevu/relay", () => {
  it("health check reports a blind service", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ service: "randevu-relay", blind: true });
  });
});
