/// <reference types="@cloudflare/vitest-pool-workers" />
import { describe, it, expect } from "vitest";
import { env } from "cloudflare:test";
import type { Room } from "./index";

// Exercises the real Room Durable Object inside workerd — open/join/send/receive/status
// and the phantom-room guard — which node vitest can't load (imports cloudflare:workers).

declare module "cloudflare:test" {
  interface ProvidedEnv {
    ROOM: DurableObjectNamespace<Room>;
  }
}

const room = (code: string) => env.ROOM.get(env.ROOM.idFromName(code));

describe("Room Durable Object (workerd)", () => {
  it("opens a room and assigns the first role by join order", async () => {
    const r = await room("r1").open("Alice", "negotiation", "", "", {});
    expect(r.kind).toBe("negotiation");
    expect(r.role).toBe("buyer"); // join order 0
    expect(r.members).toEqual(["Alice"]);
    expect(r.roleGuidance.length).toBeGreaterThan(0);
  });

  it("assigns the second joiner the next role", async () => {
    const code = "r2";
    await room(code).open("Alice", "negotiation", "", "", {});
    const r = await room(code).join("Bob", "");
    expect(r.role).toBe("seller"); // join order 1
    expect(r.members).toEqual(["Alice", "Bob"]);
  });

  it("rejects joining a room that was never opened (phantom room)", async () => {
    await expect(room("never-opened").join("Nobody", "")).rejects.toThrow(/room not found/);
  });

  it("stores and returns messages by cursor", async () => {
    const code = "r3";
    await room(code).open("Alice", "chat", "", "", {});
    const { seq } = await room(code).send("Alice", "hello", "message");
    expect(seq).toBe(1);
    const after0 = await room(code).receive(0);
    expect(after0.messages.map((m) => m.text)).toEqual(["hello"]);
    expect(after0.cursor).toBe(1);
    const afterCursor = await room(code).receive(1);
    expect(afterCursor.messages).toEqual([]); // range read past the cursor
  });

  it("reports status (members, roles, kind, lastSeq)", async () => {
    const code = "r4";
    await room(code).open("Alice", "brainstorm", "", "", {});
    await room(code).send("Alice", "idea", "idea");
    const st = await room(code).status();
    expect(st.open).toBe(true);
    expect(st.members).toEqual(["Alice"]);
    expect(st.kind).toBe("brainstorm");
    expect(st.lastSeq).toBe(1);
  });

  it("wait returns immediately when a message already exists", async () => {
    const code = "r5";
    await room(code).open("Alice", "chat", "", "", {});
    await room(code).send("Alice", "ping", "message");
    const r = await room(code).wait(0, 2000);
    expect(r.messages.map((m) => m.text)).toEqual(["ping"]);
  });
});
