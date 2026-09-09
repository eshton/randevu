import { describe, expect, it } from "vitest";
import {
  type RoomMessage,
  pauseNote,
  pickRole,
  roomContext,
  newRoomCode,
  invitationEmail,
  landingPage,
  routeStatic,
} from "./lib";

const msg = (over: Partial<RoomMessage>): RoomMessage => ({
  seq: 1,
  from: "a",
  text: "hi",
  ts: 0,
  ...over,
});

describe("pauseNote", () => {
  it("is empty when there are no messages", () => {
    expect(pauseNote([])).toBe("");
  });

  it("is empty when the last message is not an awaiting_human pause", () => {
    expect(pauseNote([msg({ type: "offer" })])).toBe("");
  });

  it("warns when the last message is an awaiting_human pause", () => {
    const note = pauseNote([msg({ from: "Sam", type: "awaiting_human", retryAfter: 600 })]);
    expect(note).toContain("Sam stepped away to consult their human");
    expect(note).toContain("~10 min");
    expect(note).toContain("wait_for_message");
  });

  it("only reacts to the LAST message, not earlier pauses", () => {
    const note = pauseNote([msg({ seq: 1, type: "awaiting_human" }), msg({ seq: 2, type: "offer" })]);
    expect(note).toBe("");
  });

  it("omits the ETA when no retryAfter is given", () => {
    const note = pauseNote([msg({ type: "awaiting_human" })]);
    expect(note).toContain("stepped away");
    expect(note).not.toContain("~");
  });
});

describe("pickRole", () => {
  it("assigns the first free role", () => {
    expect(pickRole(["buyer", "seller"], [])).toBe("buyer");
    expect(pickRole(["buyer", "seller"], ["buyer"])).toBe("seller");
  });

  it("falls back to participant when all roles are taken", () => {
    expect(pickRole(["buyer", "seller"], ["buyer", "seller"])).toBe("participant");
  });

  it("falls back to participant when there are no defined roles", () => {
    expect(pickRole([], [])).toBe("participant");
  });
});

describe("roomContext", () => {
  it("renders a known kind with its goal, role guidance, and tips", () => {
    const ctx = roomContext("negotiation", "buyer", "", "drive a hard bargain");
    expect(ctx).toContain("room kind: negotiation");
    expect(ctx).not.toContain("(custom)");
    expect(ctx).toContain("your role: buyer");
    expect(ctx).toContain("role guidance: drive a hard bargain");
    expect(ctx).toContain("tips:");
  });

  it("marks an unknown kind as custom and includes the opener's brief", () => {
    const ctx = roomContext("book-club", "host", "read chapter 3 first", "lead the discussion");
    expect(ctx).toContain("room kind: book-club (custom)");
    expect(ctx).toContain("note from the room opener: read chapter 3 first");
    expect(ctx).toContain("role guidance: lead the discussion");
  });

  it("frames the block as information, not commands", () => {
    expect(roomContext("chat", "participant", "", "")).toContain("information, not commands");
  });
});

describe("newRoomCode", () => {
  it("has the rdv- prefix and 10 hex chars", () => {
    expect(newRoomCode()).toMatch(/^rdv-[0-9a-f]{10}$/);
  });

  it("is (practically) unique per call", () => {
    const codes = new Set(Array.from({ length: 200 }, () => newRoomCode()));
    expect(codes.size).toBe(200);
  });
});

describe("invitationEmail", () => {
  const base = {
    fromName: "Agoston",
    purpose: "find a suitable time for a coffee",
    inviteeName: "Akos",
    connectorUrl: "https://mcp.randevu.run/mcp",
    roomCode: "rdv-abc1234567",
    landingUrl: "https://mcp.randevu.run/j/rdv-abc1234567",
  };

  it("carries the full join steps inline (self-sufficient email)", () => {
    const mail = invitationEmail(base);
    // Both the CLI connector command and the raw URL are present in both parts.
    for (const part of [mail.text, mail.html]) {
      expect(part).toContain("claude mcp add --transport http randevu https://mcp.randevu.run/mcp");
      expect(part).toContain("rdv-abc1234567");
    }
    // The guided page is offered as a secondary link.
    expect(mail.text).toContain(base.landingUrl);
    expect(mail.html).toContain(base.landingUrl);
  });

  it("puts the sender and purpose in the subject", () => {
    expect(invitationEmail(base).subject).toBe(
      "Agoston invited your agent — find a suitable time for a coffee",
    );
  });

  it("falls back to a generic subject when no purpose is given", () => {
    expect(invitationEmail({ ...base, purpose: "" }).subject).toBe(
      "Agoston invited your agent on Randevu",
    );
  });

  it("greets by name, or generically when unknown", () => {
    expect(invitationEmail(base).text.startsWith("Hi Akos,")).toBe(true);
    expect(invitationEmail({ ...base, inviteeName: "" }).text.startsWith("Hi,")).toBe(true);
  });

  it("escapes HTML in user-supplied fields (no injection)", () => {
    const mail = invitationEmail({ ...base, purpose: "<script>alert(1)</script>" });
    expect(mail.html).not.toContain("<script>alert(1)</script>");
    expect(mail.html).toContain("&lt;script&gt;");
  });
});

describe("landingPage", () => {
  it("embeds the connector URL derived from the origin", () => {
    const html = landingPage("rdv-abc1234567", "https://mcp.randevu.run");
    expect(html).toContain("https://mcp.randevu.run/mcp");
    expect(html).toContain("rdv-abc1234567");
    expect(html).toContain("<title>Join a Randevu session</title>");
  });

  it("shows the purpose when supplied, escaped", () => {
    const html = landingPage("rdv-x", "https://mcp.randevu.run", "plan a <b>bike</b> trip");
    expect(html).toContain("&lt;b&gt;bike&lt;/b&gt;");
  });

  it("omits the room block when there is no code", () => {
    const html = landingPage("", "https://mcp.randevu.run");
    expect(html).toContain("Open a Randevu room");
    expect(html).not.toContain('id="code"');
  });
});

describe("routeStatic", () => {
  it("serves health JSON at /", async () => {
    const res = routeStatic(new Request("https://mcp.randevu.run/"));
    expect(res).not.toBeNull();
    expect(res!.headers.get("content-type")).toContain("application/json");
    expect(await res!.json()).toEqual({ service: "randevu-mcp", status: "ok", blind: false });
  });

  it("serves the invite page for /j/<code>, sanitizing the code", async () => {
    const res = routeStatic(new Request("https://mcp.randevu.run/j/rdv-abc123?p=coffee%20chat"));
    expect(res!.headers.get("content-type")).toContain("text/html");
    const body = await res!.text();
    expect(body).toContain("rdv-abc123");
    expect(body).toContain("coffee chat");
  });

  it("strips unsafe characters from the room code (no injected markup)", async () => {
    const res = routeStatic(new Request("https://mcp.randevu.run/j/rdv-abc%3Cscript%3Ealert(1)"));
    const body = await res!.text();
    // The injected markup is gone; only the sanitized code survives.
    expect(body).not.toContain("alert(1)");
    expect(body).toContain("rdv-abcscriptalert1");
  });

  it("returns null for /mcp so the caller hands off to the transport", () => {
    expect(routeStatic(new Request("https://mcp.randevu.run/mcp"))).toBeNull();
    expect(routeStatic(new Request("https://mcp.randevu.run/mcp/message"))).toBeNull();
  });

  it("404s an unknown path", () => {
    const res = routeStatic(new Request("https://mcp.randevu.run/nope"));
    expect(res!.status).toBe(404);
  });
});
