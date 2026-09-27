# Diff and MultiBook

Two small, pure, synchronous modules that sit above `Book` and below anything with a lifetime. Neither takes an Effect, a service, or a host capability.

## Diff — what changed since a baseline, and putting it back

`src/core/diff/units.ts`, over the engine. Diff answers "what have I changed since this text?" and puts pieces of it back — in the engine's **decision units** (a verse, a bridge, a chapter's opening matter), the same alignment `/review` uses, so no two screens in Sefer can disagree about which verses moved. There is no line diff anywhere in Sefer since 2026-09-27; `core/diff/diff.ts` is gone.

Its input is a **value**, not a service: `BaselineLike { bookId, stamp, text }`. Save's `Baseline` and a decoded recorded blob both satisfy it structurally, so nothing here points at Save. The engine arrives as the `GalleyService` argument.

- `unitChanges(galley, book, baseline): Result<UnitChanges, Refusal>` — the changed units between the baseline and the book's current text (`diffSkeleton`, the cached engine diff), with both texts and the working stamp. Identical texts answer by string equality with no engine call.
- `revertUnits(galley, book, changes, units): Result<Receipt, Refusal>` — puts the baseline's text back for those units as **one** `book.apply(..., "revert", trustedBy("diff.revert"))`, so one Undo takes the revert back whether it is one verse or the whole book. The edits are the engine's `mergeSplices` with the book's text as the text being edited: only the chosen units move, and everything else keeps its offsets. Unit ids are the same whichever way round two texts are diffed, which is what lets the ids `unitChanges` reported drive the merge. Refuses `Stale` (the book moved since the changes were computed), `Empty`, and `Engine` (a build without the door).

The same door is how a write lands minimally: `projectSource.apply` takes an `edits(before, after)` function, and the app passes `galley.mergeSplices(before, after, {}, "current")` — the edits that turn one text into the other, one per differing unit.

## MultiBook — one operation across many books

`src/core/multibook/multibook.ts`. Cross-book operations are **coordinated, not merged**. There is no patch language, no cross-project transaction log, and no shared history.

`makeMultiBook(books: () => readonly Book[])` — the thunk matters: Project owns Book lifetimes and instantiates and releases them as the user opens and closes things, so MultiBook must always see the current set and must never keep a book alive by holding it.

- `runAcrossBooks(label, plan)` — offers every book to `plan`; a non-null change list becomes **one** `book.apply(changes, "project.<label>", trustedBy("project.<label>"))`, so one history event per book. Isolation is the Book's business: the editor-backed Book isolates its history transaction on trusted `project.*` origins, which is what makes the Undo below take back the operation and nothing the user typed around it. Returns `Operation { label, books, at, receipts }`, or `null` when nothing changed.
- `pendingUndo()` — the one still-undoable operation, re-checked on every call. The offer is **explicitly bounded**: it expires (and clears) the moment any affected book's revision differs from the revision recorded right after the operation, or a book has been closed. Files get saved, closed and changed under us; a project command's Undo does not outlive that.
- `undoPending()` — per affected book, `book.history()?.undo()`. The plain Book has no history, and receipts record stamps rather than the text that was replaced, so they cannot be inverted. The pending record therefore also captures each book's whole text from before the operation and restores it as one whole-text `revert` change — exact, because the offer only stands while the book is untouched, and still on the one write path so subscribers see an ordinary edit.
- `dismissPending()` and `changed(fn)` — the offer appearing, expiring or being taken is the only thing MultiBook publishes; the UI turns it into a signal at the view seam.

Its users are the project-wide commands in `src/app/commands.ts`: format (`project.format`) and the every-book overlay (`project.overlay`). Find's Replace all walks the books itself.
