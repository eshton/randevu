import { DurableObject } from "cloudflare:workers";
import { KINDS, Waiters, longPoll, assignRole } from "@randevu/core";
import type { RoomMessage } from "./lib";

/**
 * A shared, plaintext meeting room for two (or more) agents. One Durable Object per
 * room code. NOT blind — this is the hosted test tier: the service can read messages.
 * Encryption/blindness is a later layer (see docs/DISTRIBUTION.md sovereign tier).
 *
 * Kept free of the MCP SDK so it loads in the Workers test runtime (vitest-pool-workers);
 * the MCP glue lives in index.ts.
 */
export interface JoinResult {
  members: string[];
  kind: string;
  role: string;
  brief: string;
  roleGuidance: string;
}

/** An agent-facing room error (e.g. joining a code that was never opened). */
export class RoomError extends Error {}

export class Room extends DurableObject {
  /** In-memory long-poll waiters, resolved when a new message is sent. */
  private readonly waiters = new Waiters();

  async open(
    name: string,
    kind: string,
    role: string,
    brief: string,
    customRoles: Record<string, string>,
  ): Promise<JoinResult> {
    if (!(await this.ctx.storage.get<boolean>("open"))) {
      await this.ctx.storage.put("open", true);
      await this.ctx.storage.put<number>("seq", 0);
      await this.ctx.storage.put<string[]>("members", []);
      await this.ctx.storage.put<Record<string, string>>("roles", {});
      await this.ctx.storage.put<string>("kind", kind || "chat");
      await this.ctx.storage.put<string>("brief", brief || "");
      await this.ctx.storage.put<Record<string, string>>("customRoles", customRoles ?? {});
    }
    return this.join(name, role);
  }

  async join(name: string, role: string): Promise<JoinResult> {
    // Reject joining a room that was never opened (a typo'd/expired code) instead of
    // silently materializing an empty room the peer will never appear in.
    if (!(await this.ctx.storage.get<boolean>("open"))) {
      throw new RoomError(`room not found — no open room with that code`);
    }
    const kind = (await this.ctx.storage.get<string>("kind")) ?? "chat";
    const brief = (await this.ctx.storage.get<string>("brief")) ?? "";
    const members = (await this.ctx.storage.get<string[]>("members")) ?? [];
    const roles = (await this.ctx.storage.get<Record<string, string>>("roles")) ?? {};
    const customRoles = (await this.ctx.storage.get<Record<string, string>>("customRoles")) ?? {};

    if (!members.includes(name)) {
      members.push(name);
      await this.ctx.storage.put("members", members);
    }
    // Deterministic join-order assignment (shared strategy with the blind tier).
    const roleKeys = KINDS[kind] ? Object.keys(KINDS[kind]!.roles) : Object.keys(customRoles);
    const order = members.indexOf(name);
    const assigned = roles[name] ?? (role || assignRole(roleKeys, order));
    roles[name] = assigned;
    await this.ctx.storage.put("roles", roles);

    const roleGuidance = KINDS[kind]?.roles[assigned] ?? customRoles[assigned] ?? "";
    return { members, kind, role: assigned, brief, roleGuidance };
  }

  async send(from: string, text: string, type: string, retryAfter?: number): Promise<{ seq: number }> {
    const seq = ((await this.ctx.storage.get<number>("seq")) ?? 0) + 1;
    await this.ctx.storage.put<number>("seq", seq);
    await this.ctx.storage.put<RoomMessage>(`msg:${String(seq).padStart(9, "0")}`, {
      seq,
      from,
      text,
      ...(type ? { type } : {}),
      ...(retryAfter !== undefined ? { retryAfter } : {}),
      ts: Date.now(),
    });
    this.waiters.wakeAll(); // release any long-poll waiters
    return { seq };
  }

  async receive(after: number): Promise<{ messages: RoomMessage[]; cursor: number }> {
    // Range read: start just past the cursor so a poll scans only new messages, not all
    // history. Message keys (`msg:` + zero-padded seq) sort lexicographically by seq.
    const start = after > 0 ? `msg:${String(after + 1).padStart(9, "0")}` : undefined;
    const map = await this.ctx.storage.list<RoomMessage>({
      prefix: "msg:",
      ...(start ? { start } : {}),
    });
    const messages = [...map.values()]
      .filter((m) => m.seq > after)
      .sort((a, b) => a.seq - b.seq);
    const cursor = messages.length ? messages[messages.length - 1]!.seq : after;
    return { messages, cursor };
  }

  /** Room status: membership, roles, kind, message count. */
  async status(): Promise<{
    open: boolean;
    members: string[];
    roles: Record<string, string>;
    kind: string;
    lastSeq: number;
  }> {
    return {
      open: (await this.ctx.storage.get<boolean>("open")) ?? false,
      members: (await this.ctx.storage.get<string[]>("members")) ?? [],
      roles: (await this.ctx.storage.get<Record<string, string>>("roles")) ?? {},
      kind: (await this.ctx.storage.get<string>("kind")) ?? "",
      lastSeq: (await this.ctx.storage.get<number>("seq")) ?? 0,
    };
  }

  /** Long-poll: return as soon as a message with seq > after exists, else after timeout. */
  async wait(after: number, timeoutMs: number): Promise<{ messages: RoomMessage[]; cursor: number }> {
    return longPoll(
      this.waiters,
      timeoutMs,
      () => this.receive(after),
      () => ({ messages: [], cursor: after }),
    );
  }
}
