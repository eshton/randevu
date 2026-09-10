import { describe, it, expect } from "vitest";
import { Waiters, longPoll } from "./waiters";

describe("Waiters", () => {
  it("releases a waiter on wakeAll before the timeout", async () => {
    const w = new Waiters();
    const start = Date.now();
    const p = w.wait(10_000);
    w.wakeAll();
    await p;
    expect(Date.now() - start).toBeLessThan(1_000); // resolved by wake, not timeout
  });

  it("resolves on timeout when no wake arrives", async () => {
    const w = new Waiters();
    const start = Date.now();
    await w.wait(20);
    expect(Date.now() - start).toBeGreaterThanOrEqual(15);
  });

  it("wakeAll releases every pending waiter and clears the set", async () => {
    const w = new Waiters();
    const order: number[] = [];
    const ps = [0, 1, 2].map((i) => w.wait(10_000).then(() => order.push(i)));
    w.wakeAll();
    await Promise.all(ps);
    expect(order.sort()).toEqual([0, 1, 2]);
    // A second wakeAll with nothing pending is a no-op (doesn't throw).
    expect(() => w.wakeAll()).not.toThrow();
  });

  it("a waiter registered after a wake still waits for the next wake", async () => {
    const w = new Waiters();
    w.wakeAll(); // nobody waiting yet
    let done = false;
    const p = w.wait(10_000).then(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false); // the earlier wake didn't leak to this waiter
    w.wakeAll();
    await p;
    expect(done).toBe(true);
  });

  it("deregisters on timeout so the set doesn't accumulate stale closures", async () => {
    const w = new Waiters();
    await Promise.all([w.wait(10), w.wait(10), w.wait(10)]);
    expect(w.size).toBe(0);
  });
});

describe("longPoll", () => {
  const empty = { messages: [] as number[], cursor: 0 };

  it("returns immediately when the first read has messages", async () => {
    const w = new Waiters();
    const r = await longPoll(w, 10_000, async () => ({ messages: [1, 2], cursor: 2 }), () => empty);
    expect(r.messages).toEqual([1, 2]);
    expect(w.size).toBe(0);
  });

  it("returns onTimeout() when nothing arrives before the deadline", async () => {
    const w = new Waiters();
    const start = Date.now();
    const r = await longPoll(w, 30, async () => empty, () => ({ messages: [], cursor: 7 }));
    expect(r.cursor).toBe(7);
    expect(Date.now() - start).toBeGreaterThanOrEqual(25);
  });

  it("re-reads and returns after a wakeAll delivers a message", async () => {
    const w = new Waiters();
    let hasMsg = false;
    const p = longPoll(
      w,
      10_000,
      async () => (hasMsg ? { messages: [42], cursor: 1 } : empty),
      () => empty,
    );
    await new Promise((r) => setTimeout(r, 10));
    hasMsg = true;
    w.wakeAll(); // a "message posted" wake
    const r = await p;
    expect(r.messages).toEqual([42]);
  });
});
