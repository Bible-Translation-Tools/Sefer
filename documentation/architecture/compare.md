# Compare

Two sources, a decision per difference, one write. `/compare` is the
reconciliation surface: it puts the open project beside another copy of the
same books — today a zip or a folder, tomorrow a git checkpoint or a remote —
and lets a reader choose, difference by difference, what this project keeps.

`src/core/compare` is the whole policy. `src/app/ui/compare` is the screen and
`src/routes/compare.tsx` names the URL.

## Both sides are sources

The rule the module exists to hold: **neither side is a closure over the
current project**. Both sides implement one port, `CompareSource`
(`src/core/compare/source.ts`):

```ts
interface CompareSource {
  readonly id: string;             // stable within a session
  readonly label: string;          // "This project (small-nt)", "shared-nt"
  readonly kind: CompareSourceKind;// "project" | "folder" | …
  readonly canApply: boolean;      // may this side be written?
  books(): Effect<readonly BookId[], CompareError>;
  read(bookId): Effect<{ text: string; stamp?: SourceStamp }, CompareError>;
  apply?(bookId, text): Effect<Receipt, CompareError>; // required iff canApply
}
```

Every Effect carries `R = never`: a source captures what it needs — a Project,
or a `FileSystem` and a root — when it is CONSTRUCTED, so a comparison can be
run from a component, a command or a test with one `run` and no context.

Two sources exist today.

- **`currentProjectSource(project)`** — the open project, and the only writable
  side. It reads through `project.book(id)`, so it sees whichever seat holds
  each book: comparing an OPEN book compares what the reader is looking at,
  unsaved keystrokes included. `apply` seats the book first
  (`project.instantiate`) and then writes the minimal line-diff change list
  through `book.apply(changes, "compare", trustedBy("compare"))` — the one
  write path, so Undo, Save, Recovery, the census and the findings all see it
  without knowing Compare exists. Seating first is what makes Apply undoable;
  a project with no seat is still written, just with no history to take it
  back.
- **`folderSource(fileSystem, root, label?)`** — any directory the FileSystem
  port can read, always read-only. A **zip is not a source kind**: the web host
  unpacks it into a scratch directory (`intake.pickInto`) and the result is a
  folder. It reuses the project's own two rules — `discoverBooks` for which
  files are books, `identifyBook` for what each is called — so a folder lists
  exactly what it would list if it were opened as a project. It scans ONCE and
  holds the texts: a comparison is a frozen snapshot, and a side that re-read
  itself would move under a decision already made.

### What a new source needs

A git checkpoint, another local project or a remote is a NEW FILE beside those
two and one more line in `src/core/compare/index.ts`. Nothing in `compare.ts`,
`decisions.ts` or the screen changes. It must:

1. answer `books()` in its own canonical order, and `read(bookId)` with the
   canonical text (LF, no BOM — decode through `src/core/source`);
2. fail `Absent` for a book it does not hold, and never for one it does;
3. be a SNAPSHOT — the same answers for the life of the source;
4. say `canApply: false` unless it can really be written, and supply `apply` if
   it says `true`;
5. add one entry to the shell's table in `src/app/ui/compare/sources.ts`, which
   is where a picker and a label live — core never opens a dialog.

## The comparison

`compareBooks(left, right)` unions the two sides' books (left's order, then
right-only books in right's) and produces one frozen `CompareResult`. Per book:

- **both sides hold it** — the hunks of `diffTexts` (`src/core/diff`), the
  line diff with no Book and no stamp. `CompareHunk` names the sides `left` and
  `right`, not `baseline`/`working`: neither side of a compare is older than
  the other, and that asymmetry belongs to Save.
- **one side holds it** — `presence: "left" | "right"`, no hunks, and exactly
  one decision for the whole book.

The unit is deliberately coarser than the proto's Onion chapter skeleton with
its moved units and interleave slots. A line hunk is already what a translator
reads, and — the property everything below depends on — the spans BETWEEN hunks
are identical on both sides, so a merged text is a walk with substitutions
rather than a second engine call.

## The decision map

`Decision` is `"left" | "right" | "undecided"`, and `Decisions` is
`ReadonlyMap<HunkId, Decision>` keyed by `hunk.id` (or `wholeBookHunkId(book)`
for a one-sided book). Absent reads as undecided.

Choosing a side changes **nothing but that map**. Nothing is written, no text
moves, and a reader may change their mind up to the moment they press Apply.
`decide`, `decideMany`, `bookCompleteness` and `completeness` are the whole
API; `completeness` is the screen's "N decided of M".

External comparisons start **unresolved**, as the proto's did. The bulk stamps
("Keep all left", "Take all right") address every hunk of every two-sided book
and never a one-sided one: a whole-book add or removal is always reviewed
explicitly.

`mergedText(book, decisions)` is what one book becomes, and `plan(result,
decisions, target)` is the whole map as what would be written — per book a
`keep`, `write`, `add` or `remove`, plus the target's text at the time of the
comparison, which is the freshness key.

## Apply, and what it refuses

`applyPlan(plan, target)` is the only function in the module that writes. It
checks everything BEFORE the first write, so a plan that will be refused writes
nothing at all, and then writes sequentially — **one apply per book, so one
revision and one Undo step each**.

It refuses, by name:

- **`ReadOnly`** — the target cannot be written. A folder is a snapshot, not a
  working copy: Sefer does not write into the zip somebody shared.
- **`Incomplete`** — a hunk is still undecided. Half a decision map is not a
  text anybody asked for.
- **`Unsupported`** — the plan would add or remove a whole book. A project's
  book set is fixed when it opens (`discoverBooks` is a snapshot), so writing a
  new file would produce a book nothing can reach until the project is
  reopened. The screen shows that side's button disabled with the reason rather
  than offering a write it cannot honour.
- **`Stale`** — the target moved after the comparison was taken. Its offsets
  and its text describe something else now, and silently re-diffing is how a
  merge tool loses somebody's paragraph. Freshness is judged on the TEXT the
  comparison read, which is stricter than the stamp and works for a side that
  has no stamp.

A book whose result equals what the target already holds is not written at all.

## The screen

`/compare` renders inside `ShellGate`. The source card holds both sides — the
open project from the same `SourceChoice` table as the other copy — and a
Compare button. Then a summary row (books differing, only in this project, only
in the other copy, "N decided of M", the bulk stamps and Apply), a **book
dropdown** naming each book and its state, and the selected book's hunks with
Keep this project's / Take the zip's per hunk (`aria-pressed`, because
undecided is neither).

### The screen never says "left" or "right"

`left` and `right` are the model's words — `CompareHunk`, `Decision` and `plan`
keep them, and should, because the model has two sides and no opinion about
them. The SCREEN says **This project** and whatever the other source calls
itself, and each `SourceChoice` carries a `shortLabel` ("this project", "the
zip", "the folder") so a button can read "Take the zip's" rather than "Take
right". A reader choosing between two copies of their own work is not reading a
coordinate system.

The colours follow the same thought, and this is why they are not red and
green. Red/green is a judgement — it says one side is a deletion and the other
an addition, which is true of a diff against your own past and false of a
comparison between two people's work. So the tint is by SIDE: the brand tint
for this project, a neutral tint for the other, each with a start-edge rule so
the pair still reads for someone who cannot separate the hues. A
`compare.colours: "sideTint" | "redGreen"` setting (default `sideTint`) is the
intended way to let a reader who prefers the old scheme have it; **it is not
registered yet** — nothing reads it, and the side tint is unconditional.

Inside a hunk, `src/core/diff/inline.ts` says which CHARACTERS differ and the
renderer marks those more strongly on both sides. It is a guarded character
LCS — common prefix and suffix trimmed first, a wholesale swap past the cap —
computed once per hunk and split back onto lines, never once per line. The
vendored engine readers were checked first and carry no diff or alignment of
any kind: the onion reader has a tree, tokens, diagnostics and a table of
contents, the sous reader a findings snapshot and a pattern table. Save &
Review's own views use the same module.

Apply is offered because `result.left.canApply` says so, names the books it is
about to write in a confirmation Dialog, and leaves a receipt line. It then
re-runs the comparison: the left side has moved, and offsets on screen that
describe the text before the write are worse than none.

## Not yet

- Adding or removing a book (see `Unsupported` above).
- A chapter view — the hunks rendered in place in the chapter's projected text.
  The list view is what exists. (Save & Review has one, over verse-aligned rows
  from `src/core/diff/verses.ts`; bringing it here is a matter of feeding it a
  `CompareHunk` list rather than a `Baseline`.)
- `compare.colours`, the setting named above.
- More sources: a git checkpoint, another local project, remote latest. The
  port is the point; each is a new file.
- The incoming-remote reconciliation narrative (auto-accept scopes, diverged
  history, dual clocks) the proto had. The decision map is its foundation.
