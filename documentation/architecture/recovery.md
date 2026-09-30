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
what the preference moves, and the default is where it starts. The listener on
the edit feed does two things only — push an entry into memory and arm a
timer. The write happens on a fiber tied to the layer's Scope, never inside
`apply`, and so does the one hash a flush takes of each book it writes.

Writing per keystroke would be the obvious way to lose nothing and the wrong
trade: every accepted edit would become a file write on the thread that paints.

## One subscriber, on the canonical text

`recovery.mount(project, diskHash)` is called **once** when a project opens
(`ProjectContext`) and unmounted when it closes. It subscribes to the
Project's own edit feed, `Project.edits`: every accepted edit to any book's
canonical text, seated or not, delivered once. The Project is the one place
that knows which object holds a book's text — the plain Book, then the seated
one, then the plain one again after `release` — and the feed moves itself at
every swap. So an edit made by the editor, a Find card, a Review take, or a
trusted apply to a book nobody has seated is journalled the same way, and a
book revisited is never subscribed twice. (Journalling used to start when the
editor focused a book: unfocused books were never backed up, and a book
visited twice was journalled twice.)

`diskHash(bookId)` is the engine hash (xxh3, `galley.hash`, over the
canonical LF text) of what the file holds — Save's baseline, which every
book gets at open and which follows every save.

A receive needs no special case: the text that arrives reaches a Book through
`SaveCoordinator.takeDisk(book, "incoming")`, one apply like any other, and the
baseline moves in the same step, so the journal finds the text back at the
file and clears ([sync](sync.md), Receiving).

## The journal file

One JSON line per accepted apply — `{ before, after, changes, origin, at }` —
after a header naming the version, project, book, path, and two hashes:

- `base`: the hash of the text the first entry applies to — the file when
  the journal began, and after a save the text just saved;
- `end`: the hash of the text the last flush left.

The file is `<journalRoot>/<projectId>/<the book's path in the project>.jsonl`
(`idOf`): keyed by PATH, not book id, because the journal's claim is "these
edits apply to this file", and a book id — read from the `\id` line — can
disagree with the file it is in. Every id goes through one spelling,
`journalId`: normalised, no leading slash, the way the disk listing spells it.
(Two spellings once made one journal two: Discard removed the file but not the
journal in memory, whose next flush wrote every entry back.)

The journal root is `HostInfo.paths().appData`, **outside every project
folder** (`RecoveryLive({ journalRoot, hasher })`, composed in
`src/app/services.ts` with the Galley hasher): Git never sees it, a shared
drive never carries it, and no project scan mistakes it for content. Writes
use `writeFileAtomic` on the whole file — append-by-rewrite is the simplest
correct thing at one book's unsaved edits, no partial line can ever be read,
and the `FileSystem` port has no append primitive to be atomic with.

## What clears a journal

A journal holds unsaved work and nothing else, so it is cleared the moment
there is none:

- **At a flush, when the text is back to the file.** A flush hashes each
  book it writes; a hash equal to `diskHash` (typing undone, a take put back)
  means nothing is unsaved, and the journal is removed instead of written
  (`journal.cleared`, a `journal.clear` note).
- **On save.** `compact(bookId, stamp, hash)` — step 7 of every save — drops
  the entries the save wrote, makes the saved text's hash the journal's new
  `base`, and removes every earlier session's journal set aside for that book.
  A save is a decision about the book: what is written is the work. It
  touches only the mounted project's journal for that book's path; a bare
  book id is `MAT` in every project.
- **On Discard**, from the banner.

## Recovery on open: one hash against the file

`pendingOnOpen(recovery, projectId, hasher)` in `src/core/recovery/reopen.ts`
lists this project's journals (not this session's own, `thisSession`), reads
each one's book file once — decoded the way `Source.decode` decodes every
file, so it is canonical text and not bytes — hashes it, and asks one
question with three answers:

1. **the file is the text the journal started from** (`base`) → offer it;
2. **the file is the text it reached** (`end`) → the work is already saved:
   discard it silently, and note it;
3. **neither** → the file changed underneath it (another tool, another
   machine): offer it as **stale**, which can be discarded but never replayed.

A journal written before hashes were kept falls back to `reachedDisk`, the old
length and last-insert check. A book file that cannot be read or decoded is
**offered**, not dropped: a file gone missing is the strongest reason to keep
the only other copy of the work. That is one listing plus one read and one
hash per journal, once per project open.

## Set aside, so no edit can overwrite it

A book's journal is one path that this session's journal for the book also
writes. Every earlier session's journal is moved out of the way first, to
`<id>@<its last entry's time>`, in two places: when `pendingOnOpen` offers it,
and — for the case the open-time check has not reached yet — at the FIRST
flush this session makes to that path (`moveAside`), which is the only place a
file is overwritten. Written before removed, so a crash between leaves two
copies, never none.

## The banner

`src/app/ui/recovery/RecoveryBanner.tsx` is the one surface, on every project
screen (landing, project page, book route, Review). It runs the check once per
open project and is **one card for the project**, with the book count and when
the work was last backed up, and two answers:

- **Restore all** instantiates each book, calls `SaveCoordinator.adopt` on it
  so the disk text becomes its baseline BEFORE the replay, and then
  `recovery.restore`. The replay goes through
  `book.apply(changes, 'recovery', trustedBy('recovery'))` — the funnel — so it
  is in the undo history, the editor sees it, Save sees the book as dirty, and
  a journal written under an older rule set is **re-judged by today's rules**.
  Restoring does not save. Stale journals are not restored; the banner says
  how many there are and leaves them to be discarded.
- **Discard all** removes the journals.

`restore` checks the book is exactly the text the journal started from — the
book's hash against `base` — and refuses whole otherwise (`text moved`): a
book edited since it opened is other text, and the entries' offsets would land
in the wrong places. The revision is not compared: a save trims the entries it
wrote, so a journal after a save starts past revision 0. (It was compared for
a day, and every journal kept across a save was refused forever.) A set-aside
journal is removed after its replay only when this session's journal
recorded every entry again; otherwise it stays and is offered next time,
rather than the only copy being deleted.

Two sessions that each left unsaved work in one book leave two journals from
the same file: they are offered newest first, and the second refuses. The
known gaps are listed in [services](../services.md#recovery).

## Journal ids are paths

A `ProjectId` is a PATH — `/sefer/projects/small-nt`, plus `#<primary>` when
the folder is a burrito — so a journal lands several directories below the
journal root, and the listing that finds it accepts any depth. The id is only a
handle; a journal's identity is the header line it carries.
