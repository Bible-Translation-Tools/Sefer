# One liner maybe ideas

- **Lazy excerpt grouping.** `group()` over findings is O(all findings) up front, about 80 ms. It could be per-book and lazy (`count`/`keyAt`/`estimateAt`/`excerptAt`) inside VirtualList. Or drop it: on a fast machine the progressive load is flickery, and one short wait with a single render might be better.

The only items left are ones you've already scheduled: the component-size refactors, which lint-results.md records as still to do.

- drafting.ts:51: that file is a placeholder for a future drafting feature that was never built. Its one function crashes on purpose if anything calls it, and nothing does. The crash message still names a planning doc we deleted. It's harmless, since nobody will ever see it; the file would go if you delete the stub.
- Hit.reading: a search result has an optional slot meant to hold the matched text as a reader sees it, without markup. Nothing ever fills it; the result cards get that text another way. It's just unused, and can be deleted next time search is touched.
