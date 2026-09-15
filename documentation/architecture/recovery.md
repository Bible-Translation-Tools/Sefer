# Recovery

The crash journal, and the one question it is allowed to ask. The mechanism —
what a journal file is, when it is written, how `restore` replays it — is in
[save and recovery](save.md); this document is the part that faces a person:
what happens when a project is opened, and what the reader is asked.

## The rule that comes first: never on the keystroke path

`DEFAULT_JOURNAL_POLICY` is 500 ms of quiet, 5 s maximum, and it stays that
way. `Recovery.attach` subscribes to `book.changes`, and its listener does two
things only — push an entry into memory and arm a timer. The write happens on a
fiber tied to the layer's Scope, never inside `apply`.

Writing per keystroke would be the obvious way to lose nothing and the wrong
trade: every accepted edit would become a file write on the thread that paints
the editor, for a window of half a second of work. The debounce is what makes
the journal free to the typist, and the two bounds are what stop continuous
typing from starving it — `maxIntervalMs` fires from the first edit of a burst
however long the burst runs.

Changing the policy is a decision about how much unsaved work a crash may cost,
and it belongs here, not in a call site.

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
   every file Sefer reads — canonical LF, no BOM, valid UTF-8 — so the
   comparison is against canonical text and not against bytes;
3. **match** → `discard` the journal silently, and note it. The work reached
   disk; the journal is a duplicate of the project's own bytes.
4. **mismatch** → offer it.

That is one directory listing plus one read per journal, once per project open.

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

`src/app/ui/recovery/RecoveryBanner.tsx` is the surface, mounted at the top of
the projects landing when a project is open, and exported so the project route
can mount it too. It runs the check once per open project — keyed on the
project's id, not on `shell.tick()`, because an edit cannot change the answer.

- **Keep** is `project.instantiate(bookId)` and then `recovery.restore`. The
  replay goes through `book.apply(changes, 'recovery', trustedBy('recovery'))`
  — the funnel — so the text arrives as ordinary applied changes: it is in the
  undo history, the editor sees it, Save sees the book as dirty, and a journal
  written under an older rule set is **re-judged by today's rules** rather than
  trusted. Restoring does not save: autosave arms on the next change, so the
  recovered work reaches disk when the book is edited again or saved
  explicitly. Until then the journal stays, which is the conservative order —
  the work exists in two places rather than none.
- **Discard** removes the journal.

Both answers remove the row, and the card disappears with the last one: an
answered question stops being a question.

A journal for a book this session already has open is the live backup of what
is on screen — replaying it would re-apply edits the editor is already
showing — so it is filtered out. The Save panel's own Restore/Discard list
(the in-session view of the same journals) is unchanged and still there.

## Journal ids are paths

A journal lives at `<journalRoot>/<projectId>/<bookId>.jsonl`, and a
`ProjectId` is a PATH — `/sefer/projects/small-nt`, plus `#<primary>` when the
folder is a burrito. So the file lands several directories below the journal
root, and the listing that finds it must accept any depth. It once required
exactly two segments, which is to say `pending` found nothing at all on either
real host. The id is only a handle; a journal's identity is the header line it
carries, which is what `pending` reads.
