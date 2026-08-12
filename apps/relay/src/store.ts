/**
 * Minimal async key-value store the session logic runs on. In production it is
 * backed by Durable Object storage (serialized per session); in tests by an
 * in-memory map. Keeping the logic storage-agnostic lets us unit-test it in node
 * without the Workers runtime.
 */
export interface KvStore {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  /** Return all entries whose key starts with `prefix`, sorted by key ascending. */
  list<T>(prefix: string): Promise<Map<string, T>>;
}

/** In-memory KvStore for tests. Single-threaded, like a Durable Object. */
export class MemoryKvStore implements KvStore {
  private readonly map = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.map.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async list<T>(prefix: string): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    for (const key of [...this.map.keys()].sort()) {
      if (key.startsWith(prefix)) out.set(key, this.map.get(key) as T);
    }
    return out;
  }
}
