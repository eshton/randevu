// setTimeout/clearTimeout exist at runtime in every host (Node, Cloudflare Workers,
// browsers) but not in the bare ES2022 lib this package compiles against. Declare the
// minimum we use so core stays host-agnostic without pulling in DOM/Node lib types.
declare function setTimeout(handler: () => void, timeout: number): unknown;
declare function clearTimeout(id: unknown): void;

/**
 * A small set of long-poll waiters for a single-threaded Durable Object. A reader
 * `wait(ms)`s for either a `wakeAll()` (a new message arrived) or its own timeout,
 * whichever comes first. Shared by the blind relay and the hosted MCP room so the
 * concurrency logic lives in exactly one place.
 *
 * Correctness relies on the DO being single-threaded: register the waiter
 * synchronously after your last `await` so no `wakeAll()` can slip in between.
 */
export class Waiters {
  private waiters: Array<() => void> = [];

  /** Release everyone currently waiting (e.g. after a message is stored). */
  wakeAll(): void {
    const pending = this.waiters;
    this.waiters = [];
    for (const resolve of pending) resolve();
  }

  /** Resolve on the next `wakeAll()`, or after `timeoutMs`, whichever is first. */
  wait(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const entry = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        // Deregister on timeout so a rarely-woken set doesn't accumulate stale closures.
        const i = this.waiters.indexOf(entry);
        if (i !== -1) this.waiters.splice(i, 1);
        resolve();
      }, timeoutMs);
      this.waiters.push(entry);
    });
  }
}
