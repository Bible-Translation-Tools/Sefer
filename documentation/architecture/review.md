# Review

**One screen for one question: these two texts differ; which do I keep.**

`/review` replaces two screens. Save & Review diffed the editor against the
file and offered Revert; Compare put the project beside a zip and offered
Apply. They had different words for the same things (`baseline`/`working`
against `left`/`right`), two ideas of what a difference is (a verse row against
a line hunk), two inline diffs, and one of them had the file hard-coded on one
side. Will, 2026-09-15: *"yes on one screen"*.

`/history?review=1` redirects here. `/history` keeps the commit
timeline, which is the screen about what HAS happened rather than what is about
to.

- `src/app/ui/review/` — the screen, the source table, the unit card.
- `src/core/compare/` — the port, the comparison, the plan, the one write.
- `src/core/galley/diff.ts` — the decision-unit types and the engine door.
- `src/core/diff/skeleton.ts` — the cache in front of that door.
- `src/core/save/`, `src/core/recovery/` — the two modules that write bytes.

---

## 1. Both sides are sources

The rule the module exists to hold: **neither side is a closure over the
current project**. Both sides implement one port, `CompareSource`
(`src/core/compare/source.ts`):

```ts
interface CompareSource {
  readonly id: string;             // stable within a session
  readonly label: string;          // "In the editor", "On disk", "shared-nt"
  readonly kind: CompareSourceKind;// "project" | "folder" | an open string ("disk", "recorded")
  readonly canApply: boolean;      // may this side be written?
  books(): Effect<readonly BookId[], CompareError>;
  read(bookId): Effect<{ text: string; stamp?: SourceStamp }, CompareError>;
  apply?(bookId, text): Effect<Receipt, CompareError>; // required iff canApply
}
```

Every Effect carries `R = never`: a source captures what it needs — a Project,
or a `FileSystem` and a root — when it is CONSTRUCTED, so a comparison can be
run from a component, a command or a test with one `run` and no context.

Core has four kinds, and the LEFT and RIGHT pickers (`src/app/ui/review/sources.ts`) offer five choices over them:

| picker choice | core source | what | writable |
| --- | --- | --- | --- |
| In the editor | `currentProjectSource` (`project`) | the books as the editor holds them, unsaved keystrokes included | **yes** |
| On disk | `savedSource` (`disk`, `src/core/compare/pastSources.ts`) | the bytes in the project's files (`SaveCoordinator.baseline`) | no |
| Last recorded | `recordedSource` (`recorded`, same file) | the blobs at HEAD, read once per commit (`src/app/ui/panels/recorded.ts`) | no |
| A zip | `folderSource` (`folder`) | a `.zip` unpacked into a scratch folder first — a zip is not a kind in core | no |
| A folder | `folderSource` (`folder`) | any directory the `FileSystem` port can read | no |

Left defaults to the editor and right to the file on disk, because that is the
comparison a reader wants nine times in ten — **not** because the screen knows
anything about them. Any pairing is legal, a zip against a folder included. The
same source on both sides is not: a text is never a review of itself, and the
option is disabled on the other side's picker rather than silently ignored.

### The target is whichever side can be written

`canApply` decides, and only the open project says `true`. So:

- project on either side → that side is the target, and Apply is offered.
- neither side is the project → the screen says **"Neither side is this
  project — reading only"** in one line and offers no Apply. A review between
  two copies neither of which is this project is a reading, and offering a
  write with nowhere to put it would be worse than saying so.

### What a new source needs

A git checkpoint, another local project or a remote is a NEW FILE in
`src/core/compare` and one more line in its `index.ts`. Nothing in
`compare.ts`, `decisions.ts` or the screen changes. It must:

1. answer `books()` in its own canonical order, and `read(bookId)` with the
   canonical text (LF, no BOM — decode through `src/core/source`);
2. fail `Absent` for a book it does not hold, and never for one it does;
3. say `canApply: false` unless it can really be written, and supply `apply` if
   it says `true`;
4. add one entry to `src/app/ui/review/sources.ts`, which is where a picker and
   a label live — core never opens a dialog.

**Freshness.** A source is ideally a frozen SNAPSHOT, so a side cannot move
under a decision already made. `recorded` and `folder` are;
`project` and `disk` deliberately are not, because a review of the editor that
did not follow the editor is a review of nothing. They read live, and the
screen re-takes the whole comparison on every shell tick while either of them
is on a side. A comparison is still a snapshot — this simply takes a new one.

### The screen never says "left" or "right"

`left` and `right` are the model's words — `CompareHunk` and the screen's
decision map keep them, and should, because the model has two sides and no opinion about
them. `baseline` and `current` are the ENGINE's words for the same two sides
(right and left respectively), and the decision wire uses them verbatim. The
SCREEN says what each source calls itself, and each choice carries a
`shortLabel` ("the editor", "the file", "the zip") so a button can read "Take
the file's" rather than "Take right". A reader choosing between two copies of
their own work is not reading a coordinate system.

The colours follow the same thought, and this is why they are not red and
green. Red/green is a judgement — it says one side is a deletion and the other
an addition, which is true of a diff against your own past and false of a
comparison between two people's work. So the tint is by SIDE: the brand tint
for the left, a neutral tint for the right, each with a start-edge rule so the
pair still reads for someone who cannot separate the hues.

---

## 2. The unit is Onion's decision unit

A difference is a **decision unit**, addressed by reference: a verse, a bridge
(`\v 5-7`), a chapter's opening matter, the front matter before the first `\c`.
A reviewer reads "1:4", not "lines 12–14".

That shape is the engine's. `onion/src/diff.rs` cuts each side into blocks at
its own table-of-contents anchors, pairs them by a deliberately loose key (book
+ chapter + verse START, so a moved or rebridged verse still pairs and a
renumbered one reads as a delete plus an add), and reports coalesced bridges,
duplicate contexts, pure relabels and markup-only changes.

`src/core/galley/diff.ts` mirrors that wire in TypeScript — `DiffSkeleton`,
`DecisionUnit`, `Slot`, `Addr`, `CoveredBy`, `UnitTextDiff` — and binds the
door off the wasm module. See [galley.md](galley.md).

`diffSkeleton(galley, book, baselineText, currentText)`
(`src/core/diff/skeleton.ts`) is the **one function the screen calls**, and
since scripture-kitchen v0.1.0 it is a cache in front of `Galley.diff` and
nothing else. The review re-derives its units on every shell tick, and an
engine diff of two whole books per tick is exactly the cold path this screen
must not be; the key is the pair of texts, so there is nothing to invalidate.

### There is no second diff on this screen

Review's alignment is the engine's and nothing else — Will, 2026-09-15: "the
engine is the only diff". The line diff in `src/core/diff/diff.ts` still serves
History, `compareBooks` and `projectSource` and is being retired toward the
same decision units ([diff and multibook](diff-and-multibook.md)); it has no
part in `/review`.

The badge still says **engine diff**, because a reviewer deciding what to keep
is entitled to know what aligned it. What it no longer does is choose between
two answers.

`Galley.diff` is still a `Result`, and that is not hedging. The doors are free
functions probed by name off the wasm module, so an artifact that is not the
pinned build is a real failure mode: the screen says "this build's engine has
no diff door" and offers no plan for that book. One refused book withdraws the
whole plan, because a partial plan is a write nobody asked for.

### Word marks

`diff` takes a TEXT MODE as its third argument (`"none" | "words" | "chars"`)
and Sefer asks for `"words"`. Each unit then carries runs
`{from, to, kind, what, note}` that TILE the unit's span on each side, markup
included: `what` is `"markup" | "text" | "whitespace"`, and `note` is true
inside a footnote or cross-reference. `decodeSkeleton` slices
each run's `text` from its own side, so a `TextRun` is located and readable.

Both views are marked from those runs and nothing else. The markup view uses
every run; the reading uses `readingRuns` (the non-markup ones). A note is its
own reading: the engine never lets a word span its edge, so a note added
after `grace` leaves `grace` unmarked, and the card sets note runs apart
(italic, a gap before) instead of joining them to the word before. There is no
Sefer-side word LCS any more. It decides nothing the engine had not already
decided, and a second opinion about which words changed is the thing the
sid-aligned rule exists to prevent.

### Two readings, and the "markup only" badge

The header's **Show USFM markup** switch changes what both columns show:

- the **reading** (default) — the engine's `"text"` mask (reader text: note
  prose kept), cut to the unit's span through `GalleyService.readerMask`
  (`src/app/ui/review/reading.ts`). It is the same reading the engine's runs are
  over, so changed and unchanged rows agree about footnotes, and a change
  inside a note alone is visible.
- the **source** — the exact USFM bytes of the unit's span. The only reading in
  which `\p` becoming `\m` is visible at all.

A unit whose two readings are the same string and whose two sources are not is
a **markup-only** change, and carries a badge. Such a unit is shown as SOURCE
whatever the switch says: its reading is identical by definition, so the
reading would be the same paragraph twice with the badge as the only clue that
anything changed.

---

## 3. One mental model: decide, then apply

Clicking "Keep the editor's" or "Take the file's" edits a `Map` and **nothing
else**. No text moves, nothing is written, and a reader may change their mind
up to the moment they press Apply. `aria-pressed` rather than a radio group,
because there are three states and two buttons: undecided is neither pressed.

Apply projects the map once — `ReviewPanel` builds the plan per book with
`mergeWithDecisions` (`src/core/diff/skeleton.ts`), which prefers the engine's
own merge — names the books it is about to write in a confirmation, and writes
through `applyPlan` → `book.apply` — one apply per
book, so one revision and one Undo step each.

**Revert is that, exactly.** Taking the file's version of a unit and applying it
is what "revert this verse" has always meant, and the screen says so rather
than offering a second button that does the same thing under a different name.

The one concession the past sources get is `applyPlan`'s `allowUndecided`: for
a review against the reader's own past (`disk`, `recorded`), an undecided unit
is not an unanswered question but the ordinary state of the ninety-nine units
they are content with, and reverting one verse must not mean ruling on every
other verse in the book first. The plan already makes that safe — an undecided
difference keeps the TARGET's own text, so a plan full of them writes nothing.
For a foreign copy the old rule stands: half a decision map is not a text
anybody asked for.

### What Apply refuses

`applyPlan(plan, target, options)` is the only function in `core/compare` that
writes. It checks everything BEFORE the first write, so a plan that will be
refused writes nothing at all, and then writes sequentially. It refuses, by
name:

- **`ReadOnly`** — the target cannot be written. A folder is a snapshot, not a
  working copy: Sefer does not write into the zip somebody shared.
- **`Incomplete`** — a difference is still undecided, and `allowUndecided` was
  not passed.
- **`Unsupported`** — the plan would add or remove a whole book. A project's
  book set is fixed when it opens (`discoverBooks` is a snapshot), so writing a
  new file would produce a book nothing can reach until the project is
  reopened.
- **`Stale`** — the target moved after the comparison was taken. Its offsets
  and its text describe something else now, and silently re-diffing is how a
  merge tool loses somebody's paragraph. Freshness is judged on the TEXT the
  comparison read, which is stricter than the stamp and works for a side that
  has no stamp.

A book whose result equals what the target already holds is not written at all.

---

## 4. Record a version: the save model, explicit only

**The project file is written only when a version is recorded.** There is no
timer on the file, no idle write, no `autosave` — Review's one button calls
`saveAll` and then `Git.commit`, in that order, as one action. It is offered
whenever the project is one of the two sides, because what it records is the
project's own unsaved work and not the comparison.

The only automatic write left in the product is Recovery's journal: the
**working-state backup**. It is debounced off the keystroke path ("Back up work
after", `shell.backupIdleMs`, default 500 ms), it lives outside the project,
and it is neither the file nor a version.

| What | Written by | When |
| --- | --- | --- |
| The working-state backup | `Recovery` | a moment after typing pauses |
| The project file | `SaveCoordinator.saveAll` | "Record a version" |
| The version | `Git.commit` | "Record a version", straight after the write |

A write that fails records nothing — there is no half-recorded version. A
commit that fails after a write that succeeded is reported as exactly that: the
files **are** on disk and no version holds them. That is the only way the third
status state, `on disk, not recorded`, can be reached, and the book status line
names it rather than saying "saved" and leaving the reader to find out later.

The status line's three words are `unsaved`, `recorded`, and `on disk, not
recorded`. `recorded` is inferred rather than read from git on every keystroke,
and that inference is only sound because of this model: writing the file and
recording the version are one action, so a book that matches the file matches
the last version too. `ProjectContext.saveState` holds the one exception, fed
by `noteWritten` from this screen.

Why not write on a timer as well? Because a file that moves under a shared
drive, a Git working tree and another editor without anyone asking is a file
nobody can reason about, and because a review screen whose diff is against the
disk reads a whole session's work as nothing at all. Crash-safety is the
backup's job, and it does it without touching the project's own bytes.

### The write path, end to end

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

`save(book)` is snapshot-bound: capture the stamp and text **once**; `encode`
to UTF-8; `serialize(path)(writeFileAtomic(…))`; build the receipt
`{ bookId, path, stamp, hash?, bytes, at }`; store the baseline;
`note('save','rewrote', …)`; `Recovery.compact(bookId, stamp)`. Capturing once
is the whole point: an edit that lands while the bytes are in flight stays
dirty instead of being promoted by a receipt that never described it. A
`Recovery` that cannot compact is noted, never fatal — the bytes are already on
disk.

`serialize(path)` is one Effect `Semaphore` of one permit per path. Save is the
only owner of write ordering, so two explicit saves and a `saveAll` cannot
interleave writes to the same file. `writeFileAtomic` ([storage](storage.md))
writes the deterministic `<path>.sefer-tmp` sibling and renames it over the
target.

`saveAll(books)` writes one receipt per dirty book, in order, and stops at the
first failure. Git commits receipts and never guesses.

### The Baseline contract

`Baseline { bookId; path; stamp; hash?; text; savedAt }`
(`src/core/save/baseline.ts`) is a value with no operations: what Save last
wrote for one book. Save produces exactly one per successful write; the `disk`
compare source reads it; Recovery asks about it to know what is pending.

**The file is what "On disk" means on this screen**, and that follows directly
from explicit-only saving: the file is the text nobody has agreed to change, so
the books that differ from it are exactly the books a press of "Record a
version" is about, and a project somebody merely opened differs from its files
in nothing. The review used to diff against the blob at HEAD; that was right
while the file was written on a timer and it is wrong now — a 66-book project
with no repository has no HEAD, so every book read as "recorded for the first
time" and the screen offered to record all 66. The last commit is still
History's baseline, and it is now also one of the five sources by name.

`adopt(book)` seeds a baseline from a book's current text, as "what disk
holds". It exists because "no baseline" and "not saved" are not the same thing:
a book Sefer just READ has no baseline, but the text in hand *is* the bytes on
disk. The shell calls it where it opens a book (`ProjectContext.focus`) and
where Recovery replays one, so `dirty(book)` is the only question a marker has
to ask. Adopting is refused quietly when a baseline already exists or when the
book's revision is past 0. The `disk` source follows the same rule from the
other end: a book with no baseline reads as its own current text, because that
text IS the bytes on disk.

`dirty(book)` answers from the baseline alone. No baseline means dirty. Within
a session the stamp's revision decides; when the baseline and the current text
both carry an engine hash, the hash decides. A same-length replacement can
therefore never pass as saved. `SaveCoordinatorLive({ hasher })` takes the
engine's xxh3 from composition (`src/app/services.ts`).

### Serialisation style: the dominant form, written back

Sefer **writes back the form it read** — the dominant line ending and the byte
order mark, recorded on `Source.form` by `decode` and re-applied by `encode`.
A mixed file therefore becomes uniform in its majority form the first time it
is saved. The form is never an identity: baselines, diffs, stamps and `dirty`
all speak canonical text. The rules are in [source and book](source.md).

### Conflicts

Sefer surfaces external changes and never auto-merges. `externalChanges(source)`
takes the watcher stream Project owns, reads each candidate file back, and
compares it with the baseline — the hash when both sides have one, otherwise
canonical-text equality. A change that matches what we wrote is dropped. Every
surviving change marks its book conflicted, and `save` on a conflicted book
fails with `SaveError { reason: 'Conflict' }` rather than overwriting a file
that moved under us.

`resolve(change, choice)` answers one: `keepMine` clears the conflict;
`takeDisk` re-reads and decodes the file and submits it as **one** trusted
`revert` through `book.apply`, then promotes the on-disk text to the baseline;
`compare` changes nothing and returns the on-disk text as a `Baseline`-shaped
value.

`SaveError`'s reasons are `PermissionDenied | DiskFull | Conflict | Refused |
Io`. `effect/FileSystem` normalises host errors into a tag set with no disk-full
member, so `DiskFull` is recognised from the syscall text the host preserved;
everything unrecognised is `Io`.

---

## 5. Recovery

The working-state backup is Recovery's journal: one per book, outside every
project folder, replayed through `book.apply` so today's rules re-judge it. Its
format, timing and replay are in [recovery](recovery.md). Review has its own
per-book restore list for a journal whose book nobody reopened; Restore
instantiates the book, `adopt`s its disk baseline — without it the restored
work comes back invisible to this very screen — and replays.

Recovery never writes the project file, and Save never writes the journal.

---

## Not yet

- Adding or removing a book (`Unsupported`, above).
- A chapter view — the units rendered in place in the chapter's projected text.
  The card list is what exists.
- `compare.colours: "sideTint" | "redGreen"`, a setting for readers who prefer
  the old scheme. Named, not registered; the side tint is unconditional.
- More sources: a git checkpoint, another local project, remote latest. The
  port is the point; each is a new file.
- The incoming-remote reconciliation narrative ([sync.md](sync.md)). The
  decision map is its foundation.
