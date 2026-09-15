# Save and Recovery

Two modules write bytes in the whole application: **Save** writes project files, **Recovery** writes its own journal. Neither writes inside `Book.apply`, and nothing else writes at all. `src/core/save/` and `src/core/recovery/` hold both; they read Books through the port, so the same code serves Tauri and the Web and only the `FileSystem` Layer differs.

## The save model: explicit only

**The project file is written only when a version is recorded.** There is no timer on the file, no idle write, no `autosave` — Save & Review's one button calls `saveAll` and then `Git.commit`, in that order, as one action.

The only automatic write left in the product is Recovery's journal: the **working-state backup**. It is debounced off the keystroke path ("Back up work after", `shell.backupIdleMs`, default 500 ms), it lives outside the project, and it is neither the file nor a version. Between presses, work exists in the editor and in the backup; the file is the record of the last version, and it stays that way until someone records another.

Three things follow, and they are the whole of what a reader has to understand:

| What | Written by | When |
| --- | --- | --- |
| The working-state backup | `Recovery` | a moment after typing pauses |
| The project file | `SaveCoordinator.saveAll` | "Record a version" |
| The version | `Git.commit` | "Record a version", straight after the write |

A write that fails records nothing — there is no half-recorded version. A commit that fails after a write that succeeded is reported as exactly that: the files **are** on disk and no version holds them. That is the only way the third status state, `on disk, not recorded`, can be reached, and the book status line names it rather than saying "saved" and leaving the reader to find out later.

The status line's three words are `unsaved` (the text on screen is not the text in the file), `recorded` (the file holds this text and a version holds the file), and `on disk, not recorded`. `recorded` is inferred rather than read from git on every keystroke, and that inference is only sound because of this model: writing the file and recording the version are one action, so a book that matches the file matches the last version too. `ProjectContext.saveState` holds the one exception, fed by `noteWritten` from Save & Review.

Why not write on a timer as well? Because a file that moves under a shared drive, a Git working tree and another editor without anyone asking is a file nobody can reason about, and because a review screen whose diff is against the disk reads a whole session's work as nothing at all. Crash-safety is the backup's job, and it does it without touching the project's own bytes.

## The write path, end to end

```text
keystroke → phases → apply → publish ─┬─ the view renders
                                      ├─ windows apply the same changes
                                      ├─ Save: dirty
                                      ├─ Recovery.journal armed  ← the only automatic write
                                      └─ ProjectAnalysis: stale(bookId)
"Record a version" → saveAll → save(book) → serialize(path) → writeFileAtomic
                                          → receipt → baseline → Recovery.compact
                   → Git.commit(receipts), immediately after, as the same action
```

`save(book)` is snapshot-bound, in the order the seams doc fixed: capture the stamp and text **once**; `encode` to UTF-8; `serialize(path)(writeFileAtomic(…))`; build the receipt `{ bookId, path, stamp, hash?, bytes, at }`; store the baseline; `note('save','rewrote', …)`; `Recovery.compact(bookId, stamp)`. Capturing once is the whole point: an edit that lands while the bytes are in flight stays dirty instead of being promoted by a receipt that never described it. A `Recovery` that cannot compact is noted, never fatal — the bytes are already on disk.

`serialize(path)` is one Effect `Semaphore` of one permit per path. Save is the only owner of write ordering, so two explicit saves and a `saveAll` cannot interleave writes to the same file. `writeFileAtomic` ([storage](storage.md)) writes the deterministic `<path>.sefer-tmp` sibling and renames it over the target.

`saveAll(books)` writes one receipt per dirty book, in order, and stops at the first failure. It is what Save & Review presses and what `git.commit` stages from — Git commits receipts and never guesses.

## The Baseline contract

`Baseline { bookId; path; stamp; hash?; text; savedAt }` (`src/core/save/baseline.ts`) is a value with no operations: what Save last wrote for one book. Save produces exactly one per successful write; Diff (slice 23) consumes it; Recovery asks about it to know what is pending.

**The baseline is what Save & Review diffs against**, and that follows directly from explicit-only saving. The file is the text nobody has agreed to change, so the books that differ from it are exactly the books a press of "Record a version" is about, and a project somebody merely opened differs from its files in nothing. The review used to diff against the blob at HEAD; that was right while the file was written on a timer (a whole session's work then read as nothing at all) and it is wrong now — a 66-book project with no repository has no HEAD, so every book read as "recorded for the first time" and the screen offered to record all 66. The last commit is still History's baseline, and `src/app/ui/panels/recorded.ts` exists for that screen alone.

`adopt(book)` seeds a baseline from a book's current text, as "what disk holds". It exists because "no baseline" and "not saved" are not the same thing: a book Sefer just READ has no baseline, but the text in hand *is* the bytes on disk, and marking it unsaved before anyone touched it is a lie the shell used to paper over with a revision check of its own. The shell calls it where it opens a book (`ProjectContext.focus`) and where Recovery replays one (the recovery banner and the Save panel's own restore, on the freshly instantiated book, *before* the replay), so `dirty(book)` is the only question a marker has to ask. Adopting is refused quietly when a baseline already exists (a real write, or a second visit to the same book) or when the book's revision is past 0 — a revision past 0 means something has applied since the read, most likely a Recovery replay, and that text is genuinely not on disk.

### Reading a book's changes: two views of the same diff

`core/diff` is line-based, which is what a revert needs (one range splice through `book.apply`) and not what a translator reads. So Save & Review offers two readings of the one diff, and neither of them is a second opinion about what changed:

- **Side by side** (the default): the file on the left, the editor on the right, rows keyed by the verse's own reference so the columns stay level when a paragraph is added on one side, under a heading per chapter. `src/core/diff/verses.ts` does the alignment and is engine-free; `src/app/ui/panels/verses.ts` is the half that asks `Galley.analyze(text).dish.toc` where the verses are, for the disk text as well as the working one, and caches by the text itself. Unchanged verses are folded away unless asked for.
- **Unified**: the hunks, as `+`/`−` lines. For a structural change that is not verse-shaped.

Inside either, `src/core/diff/inline.ts` says which *characters* of a line became which — a guarded character LCS, with a wholesale fall back past the cap — and the renderer marks those more strongly. The engine's own readers carry no alignment or diff of any kind (checked: the onion reader has a tree, tokens, diagnostics and a table of contents; the sous reader a findings snapshot and a pattern table), so this is ours to compute. Revert is offered per verse, per hunk and per file, and every one of them is `diff.revert` — the same trusted change through the same funnel, refused when the book has moved past the offsets.

`dirty(book)` answers from the baseline alone. No baseline means dirty — nothing has been saved or adopted, so everything is unsaved. Within a session the stamp's revision decides; when the baseline and the current text both carry an engine hash, the hash decides. A same-length replacement can therefore never pass as saved. Core computes no hash: `SaveCoordinatorLive({ hasher })` takes the engine's xxh3 from composition once `src/core/galley` exposes it, and `hash` is absent until then.

## Serialisation style: the dominant form, written back

Sefer **writes back the form it read**. That closes open question 2 of the editor-and-save seams the other way round from the first answer.

`decode` records two facts about the bytes on `Source.form` (`{ eol: "lf" | "crlf"; bom: boolean }`) and then throws the encoding away: the text in memory is canonical LF with no mark, exactly as before, and `apply` still refuses a carriage return. `encode` re-applies the form — CRLF back out, and the byte order mark back at the front — so a Windows project stays a Windows project and a marked file keeps its mark.

`eol` is the file's **dominant** line ending, not a claim that it was uniform: CRLF and bare LF each get a vote, the majority wins, and a tie (a file with no line ending at all included) is LF. A bare CR is normalised on the way in and does not vote. **A mixed file therefore becomes uniform in its majority form the first time it is saved** — one deliberate, visible change, rather than a file that stays half one thing forever.

The form is never an identity. Baselines, diffs, stamps, `dirty`, and external-change comparison all speak canonical text, so the same content saved as LF and as CRLF is the same text everywhere in the product; only `encode` and the receipt's `bytes` count know the difference. `SourceStamp.length` counts canonical characters, which is why a CRLF file's byte count is larger than its stamped length.

`decode`'s only refusal is now `InvalidUtf8`. A byte order mark and a mixed-newline file were both refusals before this; they are read and remembered instead, because the alternative was a project Sefer could see and not open.

## Conflicts

Sefer surfaces external changes and never auto-merges. `externalChanges(source)` takes the watcher stream Project owns (structurally: `{ bookId, path, kind }`), reads each candidate file back, and compares it with the baseline — the hash when both sides have one, otherwise canonical-text equality. A change that matches what we wrote is dropped, so saving our own bytes does not raise a conflict. Every surviving change marks its book conflicted, and `save` on a conflicted book fails with `SaveError { reason: 'Conflict' }` rather than overwriting a file that moved under us.

`resolve(change, choice)` answers one:

- `keepMine` clears the conflict, so the next save overwrites.
- `takeDisk` re-reads and decodes the file and submits it as **one** trusted `revert` through `book.apply` — the funnel, never a text assignment — then promotes the on-disk text to the baseline.
- `compare` changes nothing and returns the on-disk text as a `Baseline`-shaped value for Diff. The other two return `None`.

`SaveError`'s reasons are `PermissionDenied | DiskFull | Conflict | Refused | Io`. `effect/FileSystem` normalises host errors into a tag set with no disk-full member, so `DiskFull` is recognised from the syscall text the host preserved; everything unrecognised is `Io`.

## The journal, and why it lives outside the project

`Recovery` appends one JSON line per accepted apply — `{ before, after, changes, origin, at }` — to `<journalRoot>/<projectId>/<bookId>.jsonl`, after a header line naming the version, project, book and path so a file found on disk is self-describing. `attach(book, projectId)` is the ordinary entry point: it subscribes to `book.changes` and journals until the Scope closes, debounced ~500 ms and coalesced into one write per burst. `setPolicy` re-times it from the reader's "Back up work after" preference: the debounce fiber re-reads its two bounds on every pass, so the stepper on `/settings` lands on the next burst without restarting anything.

The journal root is **outside every project folder**: Git never sees it, a shared drive never carries it, and no project scan mistakes it for content. `RecoveryLive({ journalRoot })` takes it as a plain string today; composition should pass `HostInfo.paths().appData`.

Writes use `writeFileAtomic` on the whole file. Append-by-rewrite is the simplest correct thing at this scale — one book's unsaved edits — no partial line can ever be read, and the `FileSystem` port has no append primitive to be atomic with.

Under explicit-only saving this journal is the only thing between a crash and a lost session, which is why its timing is a preference and its debounce is bounded at both ends.

On boot, `pending(baselineOf)` reports the journals that hold work Save never wrote: no baseline, or a last entry past the baseline's revision. It never fails — a missing root is no pending work and a corrupt journal is skipped with a note, because boot must not stop over crash recovery. `restore(id, resolveBook)` replays the entries in order through `book.apply(changes, 'recovery', trustedBy('recovery'))`, so a journal written under an older rule set is **re-judged** by today's rules; the first refusal stops the replay with a `RecoveryError`. `discard(id)` throws a journal away, and `compact(bookId, stamp)` drops the entries at or before a saved revision and removes an emptied file.

Recovery never writes the project file, and Save never writes the journal.
