interface Entry {
  at: number;
  value: unknown;
  bytes: number;
}
/** Independent count/byte-bounded LRU cache. Pending computations are single-flight, never cached failures. */
export class BoundedCache {
  private entries = new Map<string, Entry>();
  private pending = new Map<string, Promise<unknown>>();
  private retainedBytes = 0;
  constructor(
    private maxEntries: number,
    private maxBytes: number,
    private onLookup: (hit: boolean) => void = () => {},
  ) {}
  get size() {
    return this.entries.size;
  }
  get bytes() {
    return this.retainedBytes;
  }
  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) this.retainedBytes -= entry.bytes;
    this.entries.delete(key);
  }
  get<T>(
    key: string,
    fn: () => Promise<T>,
    ttl = 2000,
    force = false,
  ): Promise<T> {
    const entry = this.entries.get(key);
    if (!force && entry && Date.now() - entry.at < ttl) {
      this.entries.delete(key);
      this.entries.set(key, entry);
      this.onLookup(true);
      return Promise.resolve(entry.value as T);
    }
    const running = this.pending.get(key);
    if (running) {
      this.onLookup(true);
      return running as Promise<T>;
    }
    this.onLookup(false);
    // The microtask also turns synchronous exceptions from fn into handled promise rejections.
    const promise = Promise.resolve()
      .then(fn)
      .then(
        (value) => {
          this.pending.delete(key);
          this.remove(key);
          // Serialized UTF-8 plus UTF-16 is a conservative text-retention estimate. Oversized
          // results are returned to callers but never displace the entire cache.
          const encoded = JSON.stringify(value) ?? "";
          const bytes =
            Buffer.byteLength(key) +
            Buffer.byteLength(encoded) +
            encoded.length * 2 +
            128;
          if (bytes <= this.maxBytes) {
            this.entries.set(key, { at: Date.now(), value, bytes });
            this.retainedBytes += bytes;
            while (
              this.entries.size > this.maxEntries ||
              this.retainedBytes > this.maxBytes
            )
              this.remove(this.entries.keys().next().value!);
          }
          return value;
        },
        (error) => {
          this.pending.delete(key);
          throw error;
        },
      );
    this.pending.set(key, promise);
    return promise;
  }
  swr<T>(key: string, fn: () => Promise<T>, ttl: number): Promise<T> {
    const entry = this.entries.get(key);
    if (!entry) return this.get(key, fn, ttl);
    this.entries.delete(key);
    this.entries.set(key, entry);
    if (Date.now() - entry.at >= ttl)
      void this.get(key, fn, ttl, true).catch(() => {});
    else this.onLookup(true);
    return Promise.resolve(entry.value as T);
  }
}
