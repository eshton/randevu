import { describe, it, expect } from "vitest";
import { Waiters } from "./waiters";

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
});
