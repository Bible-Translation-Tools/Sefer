/** Small deterministic bounds used by the disposable local history prototype. */
export class BoundedLru<K, V> {
  private readonly held = new Map<K, V>();
  private heldWeight = 0;

  constructor(
    private readonly limit: number,
    private readonly weightOf: (value: V) => number = () => 0,
    private readonly weightLimit = Number.POSITIVE_INFINITY,
  ) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("LRU limit must be positive");
    if (!(weightLimit > 0)) throw new Error("LRU weight limit must be positive");
  }

  get size(): number {
    return this.held.size;
  }

  get weight(): number {
    return this.heldWeight;
  }

  get(key: K): V | undefined {
    const value = this.held.get(key);
    if (value === undefined) return undefined;
    this.held.delete(key);
    this.held.set(key, value);
    return value;
  }

  clear(): void {
    this.held.clear();
    this.heldWeight = 0;
  }

  /** Read without making the entry recent; for renders, which are not uses. */
  peek(key: K): V | undefined {
    return this.held.get(key);
  }

  set(key: K, value: V): void {
    const weight = this.weightOf(value);
    const previous = this.held.get(key);
    if (previous !== undefined) this.heldWeight -= this.weightOf(previous);
    this.held.delete(key);
    if (weight > this.weightLimit) return;
    this.held.set(key, value);
    this.heldWeight += weight;
    while (this.held.size > this.limit || this.heldWeight > this.weightLimit) {
      const oldest = this.held.entries().next();
      if (oldest.done === true) break;
      this.heldWeight -= this.weightOf(oldest.value[1]);
      this.held.delete(oldest.value[0]);
    }
  }

  values(): IterableIterator<V> {
    return this.held.values();
  }
}

/** Inclusive frame indexes around a selected after-version, newest first. */
export const nearbyFrameIndexes = (
  length: number,
  selected: number,
  radius = 2,
): readonly number[] => {
  if (length < 0 || radius < 0) return [];
  const center = Math.max(0, Math.min(Math.trunc(selected), length - 1));
  const from = Math.max(0, center - Math.trunc(radius));
  const to = Math.min(length, center + Math.trunc(radius) + 1);
  return Array.from({ length: Math.max(0, to - from) }, (_, offset) => from + offset);
};

/** Ordered older/newer pair identity; commit IDs stand in for blob OIDs here. */
export const historyPairKey = (path: string, olderCommit: string, newerCommit: string): string =>
  JSON.stringify([path, olderCommit, newerCommit]);
