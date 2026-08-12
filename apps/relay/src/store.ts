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

/**
 * In-memory KvStore for tests. Single-threaded, like a Durable Object. Clones on
 * read/write so stored state is isolated from callers — matching real DO storage,
 * which serializes values (so mutating a returned object can't corrupt the store).
 */
export class MemoryKvStore implements KvStore {
  private readonly map = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.map.get(key);
    return value === undefined ? undefined : (structuredClone(value) as T);
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.map.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }

  async list<T>(prefix: string): Promise<Map<string, T>> {
    const out = new Map<string, T>();
    for (const key of [...this.map.keys()].sort()) {
      if (key.startsWith(prefix)) out.set(key, structuredClone(this.map.get(key)) as T);
    }
    return out;
  }
}
