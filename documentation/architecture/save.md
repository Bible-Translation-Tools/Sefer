# Save and Recovery

Two modules write bytes in the whole application: **Save** writes project files, **Recovery** writes its own journal. Neither writes inside `Book.apply`, and nothing else writes at all. `src/core/save/` and `src/core/recovery/` hold both; they read Books through the port, so the same code serves Tauri and the Web and only the `FileSystem` Layer differs.

## The write path, end to end

```text
keystroke → phases → apply → publish ─┬─ the view renders
                                      ├─ windows apply the same changes
                                      ├─ Save: dirty; autosave armed; Recovery.journal armed
                                      └─ ProjectAnalysis: stale(bookId)
autosave fires / the user saves → save(book) → serialize(path) → writeFileAtomic
                                → receipt → baseline → Recovery.compact
Git.commit(receipts) later, explicitly
```

`save(book)` is snapshot-bound, in the order the seams doc fixed: capture the stamp and text **once**; `encode` to UTF-8; `serialize(path)(writeFileAtomic(…))`; build the receipt `{ bookId, path, stamp, hash?, bytes, at }`; store the baseline; `note('save','rewrote', …)`; `Recovery.compact(bookId, stamp)`. Capturing once is the whole point: an edit that lands while the bytes are in flight stays dirty instead of being promoted by a receipt that never described it. A `Recovery` that cannot compact is noted, never fatal — the bytes are already on disk.

`serialize(path)` is one Effect `Semaphore` of one permit per path. Save is the only owner of write ordering, so an explicit save, an autosave and a `saveAll` cannot interleave writes to the same file. `writeFileAtomic` ([storage](storage.md)) writes the deterministic `<path>.sefer-tmp` sibling and renames it over the target.

`autosave(book, policy)` subscribes to `book.changes` and arms the shared two-bound debounce (`src/core/schedule/debounce.ts` — Save's autosave, Recovery's journal and ProjectAnalysis's re-analyze loop are the three callers) with two bounds — `idleMs` of quiet, and `maxIntervalMs` from the first edit of a burst so continuous typing still saves. The listener touches two numbers and opens a latch; the save runs on a fiber tied to the Scope, never inside `apply`. Autosave failures are noted, not raised: a disk that cannot be written must not tear down the editor.

## The Baseline contract

`Baseline { bookId; path; stamp; hash?; text; savedAt }` (`src/core/save/baseline.ts`) is a value with no operations: what Save last wrote for one book. Save produces exactly one per successful write; Diff (slice 23) consumes it; Recovery asks about it to know what is pending.

`adopt(book)` seeds a baseline from a book's current text, as "what disk holds". It exists because "no baseline" and "not saved" are not the same thing: a book Sefer just READ has no baseline, but the text in hand *is* the bytes on disk, and marking it unsaved before anyone touched it is a lie the shell used to paper over with a revision check of its own. The shell calls it where it opens a book (`ProjectContext.focus`), so `dirty(book)` is the only question a marker has to ask. Adopting is refused quietly when a baseline already exists (a real write, or a second visit to the same book) or when the book's revision is past 0 — a revision past 0 means something has applied since the read, most likely a Recovery replay, and that text is genuinely not on disk.

`dirty(book)` answers from the baseline alone. No baseline means dirty — nothing has been saved or adopted, so everything is unsaved. Within a session the stamp's revision decides; when the baseline and the current text both carry an engine hash, the hash decides. A same-length replacement can therefore never pass as saved. Core computes no hash: `SaveCoordinatorLive({ hasher })` takes the engine's xxh3 from composition once `src/core/galley` exposes it, and `hash` is absent until then.

## Serialisation style: always LF

Sefer **always writes canonical LF**, and does not remember the file's original newline style. That closes open question 2 of the editor-and-save seams. `decode` normalises CRLF and CR on the way in and refuses a file that mixes them, and `Source` deliberately does not remember what it normalised; preserving the original style would mean carrying a second identity for the same text through every product. If remembering it is ever wanted, it belongs in `saveCoordinator.ts` next to `encode`, not in `Source`.

## Conflicts

Sefer surfaces external changes and never auto-merges. `externalChanges(source)` takes the watcher stream Project owns (structurally: `{ bookId, path, kind }`), reads each candidate file back, and compares it with the baseline — the hash when both sides have one, otherwise canonical-text equality. A change that matches what we wrote is dropped, so saving our own bytes does not raise a conflict. Every surviving change marks its book conflicted, and `save` on a conflicted book fails with `SaveError { reason: 'Conflict' }` rather than overwriting a file that moved under us.

`resolve(change, choice)` answers one:

- `keepMine` clears the conflict, so the next save overwrites.
- `takeDisk` re-reads and decodes the file and submits it as **one** trusted `revert` through `book.apply` — the funnel, never a text assignment — then promotes the on-disk text to the baseline.
- `compare` changes nothing and returns the on-disk text as a `Baseline`-shaped value for Diff. The other two return `None`.

`SaveError`'s reasons are `PermissionDenied | DiskFull | Conflict | Refused | Io`. `effect/FileSystem` normalises host errors into a tag set with no disk-full member, so `DiskFull` is recognised from the syscall text the host preserved; everything unrecognised is `Io`.

## The journal, and why it lives outside the project

`Recovery` appends one JSON line per accepted apply — `{ before, after, changes, origin, at }` — to `<journalRoot>/<projectId>/<bookId>.jsonl`, after a header line naming the version, project, book and path so a file found on disk is self-describing. `attach(book, projectId)` is the ordinary entry point: it subscribes to `book.changes` and journals until the Scope closes, debounced ~500 ms and coalesced into one write per burst.

The journal root is **outside every project folder**: Git never sees it, a shared drive never carries it, and no project scan mistakes it for content. `RecoveryLive({ journalRoot })` takes it as a plain string today; composition should pass `HostInfo.paths().appData`.

Writes use `writeFileAtomic` on the whole file. Append-by-rewrite is the simplest correct thing at this scale — one book's unsaved edits — no partial line can ever be read, and the `FileSystem` port has no append primitive to be atomic with.

On boot, `pending(baselineOf)` reports the journals that hold work Save never wrote: no baseline, or a last entry past the baseline's revision. It never fails — a missing root is no pending work and a corrupt journal is skipped with a note, because boot must not stop over crash recovery. `restore(id, resolveBook)` replays the entries in order through `book.apply(changes, 'recovery', trustedBy('recovery'))`, so a journal written under an older rule set is **re-judged** by today's rules; the first refusal stops the replay with a `RecoveryError`. `discard(id)` throws a journal away, and `compact(bookId, stamp)` drops the entries at or before a saved revision and removes an emptied file.

Recovery never writes the project file, and Save never writes the journal.
