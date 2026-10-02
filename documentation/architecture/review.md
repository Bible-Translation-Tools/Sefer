# Review

**One screen for one question: these two texts differ; which do I keep.**

`/review` replaces two screens. Save & Review diffed the editor against the
file and offered Revert; Compare put the project beside a zip and offered
Apply. They had different words for the same things (`baseline`/`working`
against `left`/`right`), two ideas of what a difference is (a verse row against
a line hunk), two inline diffs, and one of them had the file hard-coded on one
side. Will, 2026-09-15: _"yes on one screen"_.

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
  readonly id: string; // stable within a session
  readonly label: string; // "In the editor", "On disk", "shared-nt"
  readonly kind: CompareSourceKind; // "project" | "folder" | an open string ("disk", "recorded", "remote")
  readonly canApply: boolean; // may this side be written?
  books(): Effect<readonly BookId[], CompareError>;
  read(bookId): Effect<{ text: string; stamp?: SourceStamp }, CompareError>;
  apply?(bookId, text): Effect<Receipt, CompareError>; // required iff canApply
}
```

Every Effect carries `R = never`: a source captures what it needs — a Project,
or a `FileSystem` and a root — when it is CONSTRUCTED, so a comparison can be
run from a component, a command or a test with one `run` and no context.

Core has five kinds, and the LEFT and RIGHT pickers (`src/app/ui/review/sources.ts`) offer six choices over them:

| picker choice      | core source                                               | what                                                                        | writable |
| ------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------- | -------- |
| In the editor      | `currentProjectSource` (`project`)                        | the books as the editor holds them, unsaved keystrokes included             | **yes**  |
| On disk            | `savedSource` (`disk`, `src/core/compare/pastSources.ts`) | the bytes in the project's files (`SaveCoordinator.baseline`)               | no       |
| Last recorded      | `recordedSource` (`recorded`, same file)                  | the blobs at HEAD, read once per commit (`src/app/ui/panels/recorded.ts`)   | no       |
| The shared project | `sharedSource` (`remote`, same file)                      | the blobs at the remote-tracking ref, as of the last check                  | no       |
| A zip              | `folderSource` (`folder`)                                 | a `.zip` unpacked into a scratch folder first — a zip is not a kind in core | no       |
| A folder           | `folderSource` (`folder`)                                 | any directory the `FileSystem` port can read                                | no       |

Left defaults to the editor and right to the file on disk, because that is the
comparison a reader wants nine times in ten — **not** because the screen knows
anything about them. Any pairing is legal, a zip against a folder included. The
same source on both sides is not: a text is never a review of itself, and the
option is disabled on the other side's picker rather than silently ignored.

### The target is whichever side can be written

`canApply` decides, and only the open project says `true`. So:

- project on either side → the review edits it. The working text always sits
  on the left: picking it on the right swaps the two sides.
- neither side is the project → the review is **for reading**: a "Reading
  only" badge, no Edit, no double-click, no Keep / Take. A review between two
  copies neither of which is this project is a reading, and offering a write
  with nowhere to put it would be worse than saying so.

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

### Against the shared project

"The shared project" is the other side of a receive or a combine, as a source like any other: the
blobs at `refs/remotes/origin/<branch>`, read once per head (`createRecordedVersion(shell, "shared")`),
never written by a review — it changes only by sending. `/cloud`'s Compare and a contested row of the
incoming plan open it as `/project/$slug/review?against=shared`; `?pull=<n>` reads a suggestion's head
instead, labelled as that suggestion ([git](git.md), Suggested changes).

Only this pairing has a third text: the version both sides last agreed on, the merge base, read as
`createRecordedVersion(shell, "base")`. Against it, every card says where its change came from —
**Changed there**, **Changed here**, or **Changed in both places** — from the same change facts the
sync policy decides with (`bookFacts`, `src/core/sync/facts.ts`), so Review and `/cloud` cannot
disagree about which passages both people touched. It is a label, not a colour: the tint stays by
side.

Every passage has a side before anyone chooses: changed only there is preset to theirs, changed
only here to mine, and the card shows the preset as its decision. A passage changed in both places
has none, and Record a version waits until each has a choice. Pressing it SETTLES the difference
rather than only recording the editor: the presets still set to theirs are taken into the project's
text, and then the project's text — choices, presets and anything typed into the cards — is what is
recorded, with everything else the other side changed, as one version: a receive and a version, or
one decision commit ([sync](sync.md), "A contested book, settled in Review").

### The screen never says "left" or "right"

`left` and `right` are the model's words — `BookComparison` and the screen's
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

- chapter + verse START, so a moved or rebridged verse still pairs and a
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
engine is the only diff". Since 2026-09-27 it is the only diff in Sefer: History
and the project's writes use the same decision units
([diff and multibook](diff-and-multibook.md)).

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

### The reading: three layers

**The chrome is one row**, so the reading has the screen. What is compared is
a chip ("In the editor ⇄ On disk") that opens the two pickers; the count says
how far the review is; Record a version opens
a dialog for its message; the ⋯ menu holds Clear every decision (in an
editable review it takes every take back out of the text, one Undo step per
book, as each book's own Clear does), History and what aligned the diff.
Choosing another source starts over: no decisions, and the takes already
written stay as ordinary edits. Recovered work is the one recovery banner every
project screen shows, and only when there is some. The reading's own toolbar is the second row: scope, the kind
filter, a View menu (layout, USFM markup), next and previous. The project
sidebar becomes a two-tab panel, Changes and History
(`workspace/ChangesHistorySidebar.tsx`, as Zed's git panel has them). Review is
the Changes tab: each book that differs, decided of total, as Find's sidebar
becomes its results. History is the other tab: the timeline, with the selected
version's changes in the main area (`?commit=<id>`) and Adopt on either side of
a card. The route picks the tab, so Back and Forward move between them.

The differences are drawn ON the two texts, as the editor reads them — the
diff view recipe (`#editor` `mountDiffView`) paints units and word runs on each
side's own document, in regular mode or USFM (the header's **Show USFM
markup** switch). `src/app/ui/review/ReviewReader.tsx` holds it together, over
`src/app/ui/diff/`. Three layers, and each can change without the others:

- **The engine** — decision units and word runs, and the decision map above.
  Every view reads and writes the same map, keyed by book and unit, so
  switching view never loses a decision.
- **Layout** (`review.layout`: `auto` | `split` | `unified`) — side by side,
  each text its own, the other side's words red on ITS side only, and the two
  panes scrolling on their own (next / previous change brings the unit to the
  middle of both: following each other by place was too eager once the
  heights differ); or unified,
  drawn the way Zed draws hunks (`DiffHunk`, `hunkPaint`). The final text is
  what is reviewed: nothing is drawn on it but a bar beside each changed
  unit's own rows, whose tooltip names it ("Changed 3:5"). Clicking the bar,
  or the verse's number, opens the other
  side's wording at that verse, read-only, with its removed words red, and
  tints the current verse with its added words green. It is a block INSIDE the
  paragraph, so the paragraph breaks at the verse, not above a `\p` of thirty
  verses. The bars are a CodeMirror layer measured per unit, not gutter
  markers: in the reading a paragraph is one line, and in USFM verses can share
  a line, so a line cannot say which verse changed. Nothing struck ever sits
  in the text being edited. `auto` splits when the reading is at least 960 px
  wide. (Inline strike-through, and a "guess" drawn before the comparison
  while typing, were both tried on 2026-09-28 and dropped as noise:
  matklad's "unified vs split diff" is the argument.)
- **Scope** (`review.scope`: `changes` | `book`) — one CARD per TOC unit that
  changed (a verse, a bridge, a chapter's head), as Find has one card per verse
  with a hit: every change the engine reports inside that unit is on it, and
  its key is the unit's address, so it does not move when a change appears or
  goes around it. Context is the excerpt setting (`excerpts.context`, 0 by
  default: the verse alone) and each card's own control (one more above, the
  chapter, one more below, and beside them the fold toggle the paired
  reference card has — "Show only the change", and again to bring the context
  back; the one control and one rule, `stepExtent`, on every card in Sefer);
  changes that fall in a card's context are painted
  there too, and neighbouring cards may show the same context, as Find's do.
  Across every book that differs; each card's title names its whole place
  ("Genesis 3:6"), so the list has no book headers. Or the WHOLE
  BOOK with its changes drawn in place, the other pane of a split following
  your place by unit (the reference pane's `watchLocation` pattern). A card's
  book icon opens it in the book at the same change, and Changes returns to
  that card; a double-click edits, as on every card.

Both preferences are in Settings and on the reading's toolbar, which remembers
them. Scattered edits read better as cards and a rewrite reads better as the
book, so the scope is a toggle a reader flips, not a setting they visit.

**The kind filter** — All, Words, Markup and spacing — narrows the cards, the
navigation and the bulk actions to one kind, using the engine's own
classification (`isUsfmStructureChange`, `isWhitespaceChange`). A card with
formatting changes carries a "markup only" / "whitespace only" badge and a
code icon that switches that card alone to USFM. In the reading those changes are
invisible, but a card never switches mode by itself; it once did, and a
view that changes under the reader unasked reads as a bug.

**Next and previous change** — the arrows, `Alt-F5` / `Alt-Shift-F5` (VS
Code's own, as `Alt-F8` is for findings), or the palette (`review.change.next`,
`review.change.previous`). Cards step from the one at the top of the list; the
book steps unit by unit and crosses into the next book at the end of one. The
counter says where you are.

**Decisions in three sizes.** A unit, in the gutter: ✓ keeps the current
side's text, ↶ takes the other's, pressing the chosen one again clears it. A
card, in its header ("Keep all here", "Take all here"). A book, from its
row's menu in the sidebar (and the Whole book toolbar), over the changes the
filter shows; the row counts how many are decided. A decided unit stops shouting: kept is
underlined quietly, taken gets a neutral wash. Strikeout means removed words and
nothing else. There is no project-wide bulk
decision beyond Clear: "keep every markup-only change in Genesis" is a
question somebody can answer, and one click over every change in the project
is not.

**Editability is a property of what is loaded.** When the left side is this
project in the editor, the review IS the editor. There is no mode to pick.
A take is written into the editor at once (`review.diff.take`: the engine's
edits for that unit over the live text, `galley.mergeSplices`, applied
through `book.apply` as one Undo step; nothing else moves). Every
card's current side, and the whole book's, edits the real Book on a
double-click or Edit, with the diff as a plugin on it (`liveDiff` in
`src/editor/recipes/diffView.ts`). So "take theirs, then fix the comma" is a
click and some typing, the way a Find card is. A taken unit keeps its card,
washed, with "Taken from the file — put back". Put back merges the
ORIGINAL's unit into the live text, whatever else was written since. The
file is still written only by Record a version.

The DIFF names the tint, not the decision. A taken verse edited afterwards
differs again, and is red and green like any change. The decided wash marks
only a verse that reads exactly as the side it was decided for.

There was a "decide, then apply" mode, removed 2026-09-28. Decisions sat in a
map until an Apply wrote them (`applyPlan`, deleted with it). A decision
somebody has to remember to apply later is a decision that gets lost, and it
made Review the one list of places in Sefer that did not edit like the
others. An N-way review is not designed.

**Editing a card follows Find's lifecycle.** Edit (or a double-click) opens
the card's current side as the Book; the diff decorations map through the
typing, and a WORD mark the edit touches drops at once (a unit's tint maps, so
the verse does not flash); the comparison runs at a pause in typing, batched
(`TYPING_PAUSE_MS`), and the engine's cached diff means only the touched book
is diffed again; the new diff is painted only if it was taken of exactly the
text in the editor. The editor keeps its own range while it is edited rather
than re-clipping to each comparison's hunk. A card edited back to the other
side's text says "No longer a change", clears its marks, and leaves as one line
after Done.

**Tints are marks, not line classes.** In the reading a paragraph is one visual
line, so a line class tinted every verse in it; a mark is exactly the unit.

**The colours are was/now**, red for the other side's words and green for the
current side's, which is right for a review against your own past (the
default: editor against disk) and says more than it should when both sides are
somebody's work. The side tint this chapter argued for above belonged to the
column cards; whether the reading needs it too is open, and is the
`compare.colours` setting below.

---

## 3. One mental model: the review is the editor

Clicking "Keep the editor's" or "Take the file's" writes at once, one Undo
step each. `aria-pressed` rather than a radio group, because there are three
states and two buttons: undecided is neither pressed. Clicking the pressed
one again clears it, and a take cleared is put back.

**Revert is that, exactly.** Taking the file's version of a unit is what
"revert this verse" has always meant, and the screen says so rather than
offering a second button that does the same thing under a different name.

A book only one side holds is not written: a project's book set is fixed
when it opens (`discoverBooks` is a snapshot), so Review cannot add or remove
a book yet, and it says so in one line.

---

## 4. Record a version: the save model, explicit only

**The project file is written only when a version is recorded.** There is no
timer on the file, no idle write, no `autosave` — Review's one button calls
`saveAll` and then `Git.commit`, in that order, as one action
(`recordVersion`, `src/app/recordVersion.ts`, which the save key shares when
"Skip review of my changes" is on). It is offered whenever the project is one
of the two sides, because what it records is the project's own unsaved work
and not the comparison. The commit takes exactly the save's receipts, plus
what each save kept current beside its book — a burrito's `metadata.json`
checksums — so no file Sefer wrote is left unrecorded.

The version is by a person ([sync](sync.md), "Who a version is by"): the
signed-in username, or this device's name, asked once the first time. The
default message is worked out from the books BEFORE they are saved, because
after the save nothing differs and it read "Edited". When "Send my changes on
save" is on, the send follows the commit; a refused send leaves the version
recorded, and the words say only the sending did not happen.

The one other writer of a book's text and baseline is a receive: Git's bytes
arrive through `SaveCoordinator.takeDisk(book, "incoming", stamp)`, as one
edit and a new baseline in the same step ([sync](sync.md), Receiving).

The only automatic write left in the product is Recovery's journal: the
**working-state backup**. It is debounced off the keystroke path ("Back up work
after", `shell.backupIdleMs`, default 500 ms), it lives outside the project,
and it is neither the file nor a version.

| What                     | Written by                | When                                         |
| ------------------------ | ------------------------- | -------------------------------------------- |
| The working-state backup | `Recovery`                | a moment after typing pauses                 |
| The project file         | `SaveCoordinator.saveAll` | "Record a version"                           |
| The version              | `Git.commit`              | "Record a version", straight after the write |

A write that fails records nothing — there is no half-recorded version. A
commit that fails after a write that succeeded is reported as exactly that: the
files **are** on disk and no version holds them. That is the only way the third
status state, `on disk, not recorded`, can be reached.

`ProjectContext.saveState`'s three states are `unsaved`, `recorded`, and `on
disk, not recorded`. The book screen no longer shows them in a line under the
editor (removed 2026-10-01 as developer readout). `recorded` is inferred rather than read from git on every keystroke,
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
a book Sefer just READ has no baseline, but the text in hand _is_ the bytes on
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
per-book restore list for an earlier session's journal, whether or not its book
is open; Restore
instantiates the book, `adopt`s its disk baseline — without it the restored
work comes back invisible to this very screen — and replays.

Recovery never writes the project file, and Save never writes the journal.

---

## Not yet

- Adding or removing a book (`Unsupported`, above).
- A project-wide bulk decision, behind Advanced and a confirmation, if the
  per-book ones prove too slow for a formatting pass over 66 books.
- `compare.colours: "sideTint" | "redGreen"`. Named, not registered; the
  reading is red/green today (above).
- More sources: a git checkpoint, another local project. The port is the
  point; each is a new file.
