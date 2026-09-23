# Source and Book

A **Source** is one book's canonical text, the stamp that identifies it, and the form the file arrived in: `{ text, stamp, form }`, where `SourceStamp` is `{ revision, length }` and `SourceForm` is `{ eol: "lf" | "crlf"; bom: boolean }`. It is a plain value — synchronous, immutable, and owning no lifetime.

`src/core/source/source.ts` is the whole of it. `decode(bytes)` returns a `Result<Source, SourceDecodeError>` whose only refusal is `InvalidUtf8`: bytes that are not valid UTF-8 are refused rather than replaced with U+FFFD. Everything else is read and remembered. `encode(source)` writes the canonical text back as UTF-8 **in the source's own form**. `applyChange(source, change)` returns a `Result<Source, SourceChangeError>` — see the admission rules below.

## Canonical text, and the form it came in

Canonical text is always LF and never carries a byte order mark. That has not changed, and everything derived from a Source — stamps, baselines, diffs, hashes, search offsets — speaks it.

What is new is that `decode` no longer *forgets* what it normalised. It records two facts about the bytes on `Source.form`:

- **`eol`** — the file's DOMINANT line ending. CRLF and bare LF each get a vote and the majority wins; a tie, including a file with no line ending at all, is `lf`. A bare CR (classic Mac) is normalised to LF on the way in and does not vote. `dominantEol(text)` is exported for anyone who needs the same answer about a string.
- **`bom`** — whether the file began with a UTF-8 byte order mark. The mark is stripped from the text and put back by `encode`.

`applyChange` carries the form through unchanged, and so do both Book implementations: the form belongs to the bytes, not to the edit. Two Sources with the same text and different forms are **the same text** — the form is never part of any comparison, only of `encode`. A file that mixed line endings becomes uniform in its majority form the first time it is written; see [save](review.md) for what that means to a reader.

A byte order mark and a mixed-newline file used to be refusals. They are read now, because refusing them meant a project Sefer could list and not open.

Core computes no content hash. Content identity is Galley's job: the engine hashes the source (xxh3-64) on every analyze and hands it back in the analysis header, so the Galley adapter attaches that hash to every derived product. Within one Book's lifetime the stamp's revision is the identity; across lifetimes and between products the engine's hash is.

## What `applyChange` admits

`applyChange` is the only way text changes, so it is where a malformed change stops. It returns `Result<Source, SourceChangeError>`, refusing with a `reason` of:

- `RangeOutOfBounds` — `from` or `to` is not a non-negative integer, `from > to`, or `to` is past the end of the text.
- `SplitsSurrogatePair` — `from` or `to` lands between a high and a low surrogate. UTF-16 offsets are not character offsets, and slicing inside an astral character (an emoji, most historic scripts) leaves a lone surrogate on each side.
- `CarriageReturn` — `insert` contains `\r`. Canonical text is LF; `decode` normalises CR and CRLF away on the way in (remembering which it saw), and `applyChange` refuses to reintroduce either.

An admitted change produces a new `Source` with `revision + 1` and the new length. `Book.apply(changes, origin, trust?)` returns `Result<Receipt, Refusal>`, and these rules are the floor under both implementations: a refused change is not an edit, so the book stays on its current revision and publishes nothing to subscribers.

## The freshness rule

No derived product — analysis, findings, fixes, search hits, diffs, save baselines — is trusted unless the engine hash it carries matches the engine hash of the text it is applied to. Length alone never identifies text: a same-length edit is the ordinary case, and length-as-identity is the bug this rule exists to defeat. The check lives at the Galley boundary, not in Source.

## Book

`src/core/book/book.ts` is the port: one addressable USFM document and the **one write path** into its canonical text. A `Book` has an `id` (the `\id` marker's code when the text starts with `\id`, otherwise the file stem), a `path`, and four operations:

- `source()` — canonical text and stamp, from whichever seat holds it.
- `apply(changes, origin, trust?) → Result<Receipt, Refusal>` — the write path. `changes` is a `Change` or a list of them, in the coordinates of the text **before** the edit (CodeMirror's change-set convention), and must not overlap. Synchronous: it returns after every subscriber has run.
- `changes(fn(receipt, changes)) → unsubscribe` — synchronous fan-out in subscription order, after acceptance.
- `history() → History | null` — undo/redo when a CodeMirror state holds the text, `null` for the plain Book.

A `Receipt` is `{ before, after, origin }`: the stamp on each side of the edit and who asked for it. A `Refusal` is a tagged error naming the `rule` that closed the door (`source.apply` for the plain Book's range checks, an editing phase's name for the editor-backed one), its own `reason`, and a description. A refused change is not an edit: the book stays on its revision, publishes nothing, and notes `book.apply` `refused`.

`Origin` says who asked — `keyboard`, `paste`, `window`, `fix`, `format`, `replace`, `recovery`, `revert`, `project.*`, or any other string the editor recorded as CodeMirror's `userEvent`. `Trust` is separate and explicit: `UNTRUSTED` (the default) is judged by every admission rule, and `trustedBy("save.takeDisk")` bypasses the keyboard guards the way a fix-it does. The two are not the same question — a `revert` origin still has to say who trusted it.

`applyAll(source, changes)` is the shared helper: it sorts the list **back to front** and splices in that order, so each later range is untouched by the edits before it, and it stamps the result **once** — a Book edit is one revision however many changes it carried. Overlapping ranges are refused as out of range once an earlier splice has moved them. `makeListeners()` is the other shared piece: it snapshots the subscriber set before iterating, so a listener may unsubscribe itself.

### Two implementations, one port

- **The plain Book** (`makeBook(path, source, observability?)`, and `openBook(path)` which reads through the `FileSystem` service and decodes): text held as a `Source`, no admission rules beyond Source's own, no history. It serves the census, project analysis, search and multi-book operations over books nobody is editing. `openBook` fails with `PlatformError` or `SourceDecodeError` (which now means invalid UTF-8 and nothing else), and captures `Observability` through `Effect.serviceOption` at open time, which is what keeps `applyChange` synchronous: each accepted apply emits one `book.apply` note when the Layer was in context, and nothing when it was not.
- **The editor-backed Book** (`editorBook(plain, { analyze, extensions?, observability? })` in `src/editor/book.ts`): the canonical text is a CodeMirror `EditorState`, and `applyChange` runs the editing phases before accepting. It continues the plain book's revision rather than restarting it, so a Save baseline or a Recovery journal taken while the book was plain still compares against what the seat reports, and it carries the plain book's `form` beside the state — CodeMirror holds canonical text only, and Save must still write the file back the way it was read. It adds what only a state can answer — `state`, `structure()`, `bindView(view)`/`fromView(view, trs)`, `attached()`/`hold()`, `attach(receive)`, `funnel()`, `close()` — and its `history()` is real.

Readers cannot tell the two apart, which is the point: Save, Recovery, ProjectAnalysis and the UI subscribe once, through the port, and trust that they saw every edit. A view bound with `bindView` **must** route its transactions through `fromView`; a view that dispatched on its own would make publication silently incomplete, so `applyChange` throws rather than report a receipt nobody heard.

See [the editor](editor.md) for the phases and [save](review.md) for what subscribes.
