# Why-notes on single changes, in git

**Status:** idea, 2026-10-07 (Will). Not part of the cloud and git fixes; a short spike at most.
Related: [commenting and discussion](commenting-and-discussion.md), whose server-side threads stay
the answer for discussion.

## The idea

Attach a reason to one verse change — "why this rendering", "declined because…" — inside the
repository, using what Sefer already has:

- Addresses parse from text.
- A hunk id at a SHA is content addressed, and never moves: Sefer merges, never rebases.

So a note can name (commit, address, hunk id) and stay anchored for good. Find could search notes
through the history index, as a second surface for "why is this verse like this".

## Where it lives

- **Commit message vs note.** No practical length limit on either; `git log` does not truncate and
  WACS's API returns the whole message (its list views shorten it). But a message is fixed when the
  version is recorded. A git note attaches afterwards, by anyone, without changing the SHA — which
  is what "add context to an accepted change" needs.
- **Which ref.** A Sefer-owned `refs/notes/sefer` holding structured entries needs no delimiter.
  Gitea's commit page shows only the default `refs/notes/commits` (GitHub stopped showing notes
  years ago; few people use them). If being read on WACS matters, use the default ref with a
  `---sefer---` block per entry.
- **Web.** isomorphic-git has `addNote`, `readNote`, `listNotes`. Notes refs are not fetched or
  pushed by default; both have to be asked for.

## The conflict question

A notes ref is an ordinary ref with its own commits, so two devices adding notes diverge it and the
second push is refused, like a branch. Combining is easy, and isomorphic-git does not do it for us:

- Different commits annotated: the notes tree is keyed by commit SHA, so it is a union.
- Same commit annotated by both: git's own `cat_sort_uniq` strategy. Make each entry an append-only
  line with its own id, and merging is union-then-sort — WAL style, deterministic, no real
  conflicts. Deleting becomes a tombstone entry.
- The loop is fetch notes, union, push, retry on refusal.

## Limits

- No replies, visibility or notifications. Anyone who can read the repository reads every note,
  forever — not for private working discussion.
- Shallow clones hold notes for commits they do not have; such notes are unanchored until the
  history is deepened.

## Possible first use

Remembered declines (see [cloud and git follow-ups](cloud-git-followups-2026-10-06.md), "Decline
as a recorded decision"), if the closed pull request turns out not to be enough of a record.
