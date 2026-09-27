# One liner maybe ideas

- **Lazy excerpt grouping.** `group()` over findings is O(all findings) up front, about 80 ms. It could be per-book and lazy (`count`/`keyAt`/`estimateAt`/`excerptAt`) inside VirtualList. Or drop it: on a fast machine the progressive load is flickery, and one short wait with a single render might be better.
- **Stream Find's search, book by book.** "the" over en_ulb is one ~200 ms task before any card. `findInReading` already loops per book over the engine's per-book readings: search a slice, publish its hits, yield, continue. With the per-book grouping reuse in the feed, the first book's cards would show in tens of ms and the count would climb as the rest arrive.
- **The Web transport as one env var is unwieldy.** `VITE_SEFER_WEB_TRANSPORT` carries every `host=proxy` pair in one string. Alternative: the build carries only its own content host, the per-host proxy table lives in `tools/deploy/channels.ts` (it is infrastructure, the same for every channel), and the env var exists only to override it. The network settings (content host, transport, catalogue) will want a rework around it anyway.

The only items left are ones you've already scheduled: the component-size refactors, which lint-results.md records as still to do.

- drafting.ts:51: that file is a placeholder for a future drafting feature that was never built. Its one function crashes on purpose if anything calls it, and nothing does. The crash message still names a planning doc we deleted. It's harmless, since nobody will ever see it; the file would go if you delete the stub.
- Hit.reading: a search result has an optional slot meant to hold the matched text as a reader sees it, without markup. Nothing ever fills it; the result cards get that text another way. It's just unused, and can be deleted next time search is touched.
