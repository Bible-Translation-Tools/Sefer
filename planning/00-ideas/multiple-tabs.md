# Several tabs on one project (Web), parked 2026-10-01

Niche: desktop will be one window per project, and "don't open the same
project in two tabs" is an acceptable answer on the Web. Parked in favour of
History. Kept because the shape was worked out.

## The floor

A notice on the second tab: "Sefer is open in another tab; editing in both
isn't supported." A per-tab session Web Lock tells a tab it is not alone.

## The full version, if it is ever wanted

1. **Commit-time check (small).** A tab remembers the HEAD it last saw.
   Record a version asks, BEFORE Save writes any book file, whether HEAD moved
   under it. If so, the other tab's commit is "theirs" and §11's review path
   runs unchanged (mine = this editor, theirs = HEAD, base labels). One new
   CompareSource, "another tab on this device". `.git` is already guarded by
   Web Locks (`src/platform/web/locks.ts`).
2. **Per-session journals (~80–120 lines, recovery only).** Today one journal
   per book, and a session's first edit moves an earlier session's journal
   aside (`recovery.ts:141`), so two tabs editing one book take turns stealing
   the file. Instead `<book>@<session>.jsonl`, one writer per file:
   - header: the book's stamp at the session's first edit, and HEAD then;
   - liveness: each tab holds `sefer.session.<id>` for its life;
     `navigator.locks.query()` says which sessions are alive;
   - on open: list `<book>@*.jsonl`, skip live sessions; a dead one whose final
     text equals the file is deleted; one whose header matches the file
     replays; otherwise the base is rebuilt from git (the blob at the header's
     HEAD) and offered as a compare, never applied blindly;
   - identity across reload: the ID in `sessionStorage`; "Duplicate tab"
     copies it, so a tab that cannot take its session lock mints a new ID.
   - IO stays one directory listing plus one read per book with lost work.
3. **Cross-tab notice (~50 lines).** A BroadcastChannel per project: "Luke
   changed in another tab · Load the latest"; a clean tab reloads the book
   through the receive path.

Not wanted: a live mirror with a writer lock per book (read-only UX on every
surface), or a CRDT (fights exact-USFM admission).

## Aside: slow first load

Not the journal (one listing at open). Suspect `.git` stats on OPFS, measured
earlier as the hidden cost; confirm with one traced open before changing
anything.
