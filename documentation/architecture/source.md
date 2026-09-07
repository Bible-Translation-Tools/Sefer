# Source and Book

A **Source** is one book's canonical text plus the stamp that identifies it: `{ text, stamp }`, where `SourceStamp` is `{ revision, length }`. It is a plain value — synchronous, immutable, and owning no lifetime.

`src/core/source/source.ts` is the whole of it. `decode(bytes)` returns a `Result<Source, SourceDecodeError>`: it refuses a UTF-8 byte order mark, refuses bytes that are not valid UTF-8 rather than replacing them, and refuses a file that mixes CRLF, CR and LF. A file with one uniform newline style is accepted and normalised to LF, so canonical text is always LF. `encode(source)` writes that canonical text back as UTF-8. `apply(source, change)` returns a `Result<Source, SourceChangeError>` — see the admission rules below. The disk serialisation style is not remembered yet; that belongs with save (slice 10).

Core computes no content hash. Content identity is Galley's job: the engine hashes the source (xxh3-64) on every analyze and hands it back in the analysis header, so the Galley adapter attaches that hash to every derived product. Within one Book's lifetime the stamp's revision is the identity; across lifetimes and between products the engine's hash is.

## What `apply` admits

`apply` is the only way text changes, so it is where a malformed change stops. It returns `Result<Source, SourceChangeError>`, refusing with a `reason` of:

- `RangeOutOfBounds` — `from` or `to` is not a non-negative integer, `from > to`, or `to` is past the end of the text.
- `SplitsSurrogatePair` — `from` or `to` lands between a high and a low surrogate. UTF-16 offsets are not character offsets, and slicing inside an astral character (an emoji, most historic scripts) leaves a lone surrogate on each side.
- `CarriageReturn` — `insert` contains `\r`. Canonical text is LF; `decode` already refuses CR on the way in, and `apply` refuses to reintroduce it.

An admitted change produces a new `Source` with `revision + 1` and the new length. `Book.apply(change, origin)` returns `Result<Receipt, SourceChangeError>` on the same rules: a refused change is not an edit, so the book stays on its current revision, emits no `book.apply` note, and publishes nothing to subscribers.

## The freshness rule

No derived product — analysis, findings, fixes, search hits, diffs, save baselines — is trusted unless the engine hash it carries matches the engine hash of the text it is applied to. Length alone never identifies text: a same-length edit is the ordinary case, and length-as-identity is the bug this rule exists to defeat. The check lives at the Galley boundary, not in Source.

## Book

`src/core/book/book.ts` is the port and its one plain implementation. A `Book` has an `id` (the `\id` marker's code when the text starts with `\id`, otherwise the file stem), a `path`, `source()`, `apply(change, origin) → Result<Receipt, SourceChangeError>`, and `changes(fn) → unsubscribe`. A `Receipt` is `{ before, after, origin }` — the stamp on each side of the edit and who asked for it. Subscribers are called synchronously, in subscription order, after the edit lands.

`openBook(path)` reads through the `FileSystem` service and decodes, so it fails with `PlatformError` or `SourceDecodeError`. It captures `Observability` through `Effect.serviceOption` at open time, which keeps `apply` synchronous: each `apply` emits one `book.apply` note (`rewrote`, `<id> r<before> -> r<after> (<origin>)`, correlated by the book id) when the Layer was in context, and nothing when it was not.

What Book is **not** yet: it is not editor-backed (no CodeMirror state, no undo history), it cannot save, and it keeps no history beyond the current revision. Those are slices 05–08 and 10. See [plan 04](../../planning/00-ideas/v2-04-source-and-book-lifetime.md).

