# Source and Book

A **Source** is one book's canonical text plus the stamp that identifies it: `{ text, stamp }`, where `SourceStamp` is `{ revision, length, hash }`. It is a plain value — synchronous, immutable, and owning no lifetime.

`src/core/source/source.ts` is the whole of it. `decode(bytes)` returns a `Result<Source, SourceDecodeError>`: it refuses a UTF-8 byte order mark, refuses bytes that are not valid UTF-8 rather than replacing them, and refuses a file that mixes CRLF, CR and LF. A file with one uniform newline style is accepted and normalised to LF, so canonical text is always LF. `encode(source)` writes that canonical text back as UTF-8. `apply(source, change)` returns a new `Source` with `revision + 1`, a recomputed hash, and the new length. The disk serialisation style is not remembered yet; that belongs with save (slice 10).

`hash` is FNV-1a 64 over UTF-16 code units, computed in core with no dependency and rendered as sixteen hex characters. Onion's header hash (xxh3-64) may replace it at the engine boundary later; nothing here tries to match it now.

## The freshness rule

No derived product — analysis, findings, fixes, search hits, diffs, save baselines — is trusted without `describes(stamp, text)`, which compares **length and hash**. Length alone never identifies text: a same-length edit is the ordinary case, not the exotic one, and length-as-identity is the bug this rule exists to defeat.

## Book

`src/core/book/book.ts` is the port and its one plain implementation. A `Book` has an `id` (the `\id` marker's code when the text starts with `\id`, otherwise the file stem), a `path`, `source()`, `apply(change, origin) → Receipt`, and `changes(fn) → unsubscribe`. A `Receipt` is `{ before, after, origin }` — the stamp on each side of the edit and who asked for it. Subscribers are called synchronously, in subscription order, after the edit lands.

`openBook(path)` reads through the `FileSystem` service and decodes, so it fails with `PlatformError` or `SourceDecodeError`. It captures `Observability` through `Effect.serviceOption` at open time, which keeps `apply` synchronous: each `apply` emits one `book.apply` note (`rewrote`, `<id> r<before> -> r<after> (<origin>)`, correlated by the book id) when the Layer was in context, and nothing when it was not.

What Book is **not** yet: it is not editor-backed (no CodeMirror state, no undo history), it cannot save, and it keeps no history beyond the current revision. Those are slices 05–08 and 10. See [plan 04](../../planning/00-ideas/v2-04-source-and-book-lifetime.md).
