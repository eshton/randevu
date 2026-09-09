import { describe, it, expect } from "vitest";
import { assignRole, roleByOrder, rolesForKind, roomContext } from "./index";

describe("assignRole (single shared strategy)", () => {
  it("assigns by join order", () => {
    expect(assignRole(["buyer", "seller"], 0)).toBe("buyer");
    expect(assignRole(["buyer", "seller"], 1)).toBe("seller");
  });

  it("clamps past-the-end order to the last role", () => {
    expect(assignRole(["buyer", "seller"], 5)).toBe("seller");
  });

  it("negative order clamps to the first role", () => {
    expect(assignRole(["buyer", "seller"], -1)).toBe("buyer");
  });

  it("falls back to participant when there are no roles", () => {
    expect(assignRole([], 0)).toBe("participant");
  });
});

describe("roleByOrder delegates to assignRole", () => {
  it("matches assignRole over a predefined kind's roles", () => {
    const roles = rolesForKind("negotiation");
    expect(roleByOrder("negotiation", 0)).toBe(assignRole(roles, 0));
    expect(roleByOrder("negotiation", 1)).toBe(assignRole(roles, 1));
  });

  it("returns participant for an unknown kind", () => {
    expect(roleByOrder("no-such-kind", 0)).toBe("participant");
  });
});

describe("roomContext roleGuidance override", () => {
  it("uses the override when given (custom-role maps)", () => {
    expect(roomContext("custom-thing", "host", "", "lead it")).toContain("role guidance: lead it");
  });
  it("falls back to the kind's own role guidance without an override", () => {
    const roles = rolesForKind("negotiation");
    const anyRole = roles[0]!;
    expect(roomContext("negotiation", anyRole)).toContain("role guidance:");
  });
});
