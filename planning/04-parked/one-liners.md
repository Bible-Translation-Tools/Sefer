# One liner maybe ideas

- **Lazy excerpt grouping.** `group()` over findings is O(all findings) up front, about 80 ms. It could be per-book and lazy (`count`/`keyAt`/`estimateAt`/`excerptAt`) inside VirtualList. Or drop it: on a fast machine the progressive load is flickery, and one short wait with a single render might be better.
