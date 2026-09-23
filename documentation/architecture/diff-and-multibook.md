# Diff and MultiBook

Two small, pure, synchronous modules that sit above `Book` and below anything with a lifetime. Neither takes an Effect, a service, or a host capability.

## Diff — what changed since the last save

`src/core/diff/diff.ts`. Diff answers "what have I changed since this was written to disk?" and puts pieces of it back.

It is a LINE diff, and it is being retired: comparisons are meant to go through the engine's sid-aligned decision units, which is what `/review` already uses ([review](review.md)). Its remaining users are the History panel and its `src/app/ui/panels/changes.ts`, `compareBooks` in `src/core/compare/compare.ts`, and `src/core/compare/projectSource.ts`. Do not add a new one.

Its input is a **value**, not a service: `BaselineLike { bookId, stamp, text }`. Save produces the full `Baseline` (adding `path`, `hash`, `savedAt`); Diff only names the three fields it reads, structurally, so nothing in Diff points at Save — Save points at FileSystem and Observability, and Diff must stay below both. That direction is the DAG's rule, not a style preference.

- `compare(book, baseline): readonly Hunk[]` — line-based (LF lines, the only newline canonical text has), ascending, non-overlapping. USFM edits are line-shaped, a line is a hunk a translator can read, and line granularity keeps a revert one range splice.
- `revert(hunk, book)` / `revertAll(hunks, book)` — `Result<Receipt, Refusal>`, through `book.apply(..., "revert", trustedBy("diff.revert"))`. Refuses `Stale` — checked by an internal `stale(hunk, book)`: the book moved (different id, revision, or length) since the hunk was measured — rather than splicing at offsets that have moved, and `Empty` rather than stamping a no-op revision.

A `Hunk` carries `from`/`to` in **working-text** UTF-16 offsets — already `book.apply`'s before-text coordinates — plus `baselineFrom`/`baselineTo` for the old side, `kind` (`insert` = absent from the baseline, `delete` = a zero-width working range where lines were removed, `replace` = both), and both slices of text. It is stamped with the working text's stamp, so a revert can tell it has gone stale.

`revertAll` is one `apply` with the whole change list, so "discard my changes" is **one** history event rather than one per hunk.

The diff itself is a dynamic-programming LCS over lines, with common prefix and suffix trimmed first and a guard (`MAX_LCS_CELLS`) above which the differing region collapses into a single coarse `replace` hunk. Myers would be asymptotically nicer; at a book's size, after trimming, it is not the slow part, and the guarded table is a page of obvious code.

## MultiBook — one operation across many books

`src/core/multibook/multibook.ts`. Cross-book operations are **coordinated, not merged**. There is no patch language, no cross-project transaction log, and no shared history.

`makeMultiBook(books: () => readonly Book[])` — the thunk matters: Project owns Book lifetimes and instantiates and releases them as the user opens and closes things, so MultiBook must always see the current set and must never keep a book alive by holding it.

- `runAcrossBooks(label, plan)` — offers every book to `plan`; a non-null change list becomes **one** `book.apply(changes, "project.<label>", trustedBy("project.<label>"))`, so one history event per book. Isolation is the Book's business: the editor-backed Book isolates its history transaction on trusted `project.*` origins, which is what makes the Undo below take back the operation and nothing the user typed around it. Returns `Operation { label, books, at, receipts }`, or `null` when nothing changed.
- `pendingUndo()` — the one still-undoable operation, re-checked on every call. The offer is **explicitly bounded**: it expires (and clears) the moment any affected book's revision differs from the revision recorded right after the operation, or a book has been closed. Files get saved, closed and changed under us; a project command's Undo does not outlive that.
- `undoPending()` — per affected book, `book.history()?.undo()`. The plain Book has no history, and receipts record stamps rather than the text that was replaced, so they cannot be inverted. The pending record therefore also captures each book's whole text from before the operation and restores it as one whole-text `revert` change — exact, because the offer only stands while the book is untouched, and still on the one write path so subscribers see an ordinary edit.
- `dismissPending()` and `changed(fn)` — the offer appearing, expiring or being taken is the only thing MultiBook publishes; the UI turns it into a signal at the view seam.

Its users are the project-wide commands in `src/app/commands.ts`: format (`project.format`) and the every-book overlay (`project.overlay`). Find's Replace all walks the books itself.
