# Recovery

The crash journal: what a journal file is, when it is written, how it is
replayed, and the one question it is allowed to ask a person when a project
opens. The save model it backs up is in [review](review.md).

## What the journal is for, now that nothing else writes

Sefer writes the project file only on Save ([review](review.md)),
which makes this journal the **only** automatic write in the product and the
only thing standing between a crash and a lost session. It is the
working-state backup: it holds what the editor holds, it is not the file, and
it is not a version.

That raises the stakes on the debounce and changes what the banner means. The
backup's timing is now a preference a reader can see — "Back up work after" on
`/settings`, `shell.backupIdleMs`, pushed into `Recovery.setPolicy` by the
shell — because it is exactly the question "how much work may a crash cost me".
The debounce fiber re-reads its two bounds on every pass, so moving the stepper
lands on the next burst.

## The rule that comes first: never on the keystroke path

`DEFAULT_JOURNAL_POLICY` is 500 ms of quiet, 5 s maximum: the idle bound is
what the preference moves, and the default is where it starts. `Recovery.attach` subscribes to `book.changes`, and its listener does two
things only — push an entry into memory and arm a timer. The write happens on a
fiber tied to the layer's Scope, never inside `apply`.

Writing per keystroke would be the obvious way to lose nothing and the wrong
trade: every accepted edit would become a file write on the thread that paints
the editor, for a window of half a second of work. The debounce is what makes
the journal free to the typist, and the two bounds are what stop continuous
typing from starving it — `maxIntervalMs` fires from the first edit of a burst
however long the burst runs.

Changing the policy is a decision about how much unsaved work a crash may cost.
It belongs here and on the settings screen — never in a call site.

## The journal file

`Recovery` appends one JSON line per accepted apply — `{ before, after,
changes, origin, at }` — to `<journalRoot>/<projectId>/<bookId>.jsonl`, after a
header line naming the version, project, book and path so a file found on disk
is self-describing. `attach(book, projectId)` subscribes to `book.changes` and
journals until the Scope closes, coalesced into one write per burst.

The journal root is `HostInfo.paths().appData`, **outside every project
folder** (`RecoveryLive({ journalRoot })`, composed in `src/app/services.ts`):
Git never sees it, a shared drive never carries it, and no project scan
mistakes it for content. Writes use `writeFileAtomic` on the whole file —
append-by-rewrite is the simplest correct thing at one book's unsaved edits,
no partial line can ever be read, and the `FileSystem` port has no append
primitive to be atomic with.

`pending(baselineOf)` reports the journals that hold work Save never wrote: no
baseline, or a last entry past the baseline's revision. It never fails — a
missing root is no pending work and a corrupt journal is skipped with a note.
`restore(id, resolveBook)` replays the entries in order through
`book.apply(changes, 'recovery', trustedBy('recovery'))`; the first refusal
stops the replay with a `RecoveryError`. `discard(id)` throws a journal away,
and `compact(bookId, stamp)` drops the entries at or before a saved revision
and removes an emptied file. Recovery never writes the project file, and Save
never writes the journal.

## Recovery on open: one IO check, against disk

`pending(baselineOf)` — the in-session question — asks Save what it last wrote.
At open there is no answer to give: a fresh process has no baselines, so every
journal on disk reads as pending, including the ones whose work the previous
session saved perfectly well before it closed. A banner that offers work
already in the file teaches people to ignore the banner.

So the open-time question is asked against **disk**, by
`pendingOnOpen(recovery, projectId)` in `src/core/recovery/reopen.ts`:

1. list the journals for this project (`pending`, with no baselines);
2. read each journal's book file once, decoded the way `Source.decode` decodes
   every file Sefer reads — canonical LF, with the byte order mark and the line
   endings set aside as `Source.form` — so the comparison is against canonical
   text and not against bytes, and a CRLF file still matches an LF journal;
3. **match** → `discard` the journal silently, and note it. The work reached
   disk; the journal is a duplicate of the project's own bytes.
4. **mismatch** → offer it.

That is one directory listing plus one read per journal, once per project open.

Explicit-only saving decides how often each branch is taken: the file holds the
last saved version, so a journal that outlived its session usually differs and
the banner appears. The
rule does not change, and the silent half is what keeps the noisy half worth
reading — a banner that also offered work already in the file would teach
people to dismiss it.

`reachedDisk(text, journal)` is the comparison, and it is deliberately modest.
A `SourceStamp` carries a revision and a length and no content hash, so length
is the whole of what the journal can claim about the text it produced. Length
alone would be fooled by a same-length edit, so the last entry's
**lowest-offset insertion** is also checked at the offset it claims:
`applyAll` splices back to front, which means the change with the smallest
`from` is the one whose offsets survive unchanged into the finished text. Two
cheap facts, and the way they fail is the right way — a journal kept and
offered, never one deleted in error.

A book file that cannot be read or decoded is **offered**, not dropped: a file
that has gone missing or become unreadable is the strongest possible reason to
keep the only other copy of the work.

## The banner

`src/app/ui/recovery/RecoveryBanner.tsx` is the surface. It is mounted on the
projects landing when a project is open, on the project page
(`src/routes/_app/project/$slug/index.tsx`) and on the book route
(`src/routes/_app/project/$slug/book/$book.tsx`), because an open lands on the
book and unsaved work is the first thing to answer. It runs the check once per
open project — keyed on the project's id, not on any edit event, because an
edit cannot change the answer.

It is **one card for the project**, with the book count and when the work was
last backed up, and two answers:

- **Restore all** instantiates each book, calls `SaveCoordinator.adopt` on it
  so the disk text becomes its baseline BEFORE the replay, and then
  `recovery.restore`. The replay goes through
  `book.apply(changes, 'recovery', trustedBy('recovery'))` — the funnel — so the
  text arrives as ordinary applied changes: it is in the undo history, the
  editor sees it, Save sees the book as dirty, and a journal written under an
  older rule set is **re-judged by today's rules** rather than trusted.
  Restoring does not save: the book comes back **dirty** and stays that way
  until somebody saves. Recovered text is a proposal, and writing it into the
  file unasked would be Sefer making the decision. Until it is saved the
  journal stays, so the work exists in two places rather than none.
- **Discard all** removes the journals.

A journal for a book this session already has open is the live backup of what
is on screen — replaying it would re-apply edits the editor is already
showing — so it is filtered out. Review has its own per-book restore list for
the in-session view of the same journals (`src/app/ui/review/ReviewPanel.tsx`).

Known gaps — no base check before a replay, and a corrupt journal is skipped
silently — are listed in [services](../services.md#recovery).

## Journal ids are paths

A journal lives at `<journalRoot>/<projectId>/<bookId>.jsonl`, and a
`ProjectId` is a PATH — `/sefer/projects/small-nt`, plus `#<primary>` when the
folder is a burrito. So the file lands several directories below the journal
root, and the listing that finds it must accept any depth. It once required
exactly two segments, which is to say `pending` found nothing at all on either
real host. The id is only a handle; a journal's identity is the header line it
carries, which is what `pending` reads.
