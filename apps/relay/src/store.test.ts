import { describe, it, expect } from "vitest";
import { MemoryKvStore } from "./store";

describe("MemoryKvStore range read", () => {
  it("lists a prefix sorted ascending", async () => {
    const s = new MemoryKvStore();
    await s.put("msg:0002", "b");
    await s.put("msg:0001", "a");
    await s.put("other", "x");
    expect([...(await s.list<string>("msg:")).keys()]).toEqual(["msg:0001", "msg:0002"]);
  });

  it("skips keys before an inclusive start (only the tail of the prefix)", async () => {
    const s = new MemoryKvStore();
    for (const n of [1, 2, 3, 4, 5]) await s.put(`msg:${String(n).padStart(4, "0")}`, n);
    const tail = await s.list<number>("msg:", { start: "msg:0003" });
    expect([...tail.values()]).toEqual([3, 4, 5]); // start is inclusive
  });

  it("start never widens past the prefix", async () => {
    const s = new MemoryKvStore();
    await s.put("msg:0001", 1);
    await s.put("nnn:0001", 9);
    const out = await s.list<number>("msg:", { start: "aaa" });
    expect([...out.values()]).toEqual([1]); // 'nnn:' excluded by prefix, not just start
  });
});
