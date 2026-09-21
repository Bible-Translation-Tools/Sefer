# Next Git considerations: book and chapter time travel

**Status:** idea for later dispatch, 2026-09-19. No implementation authorized. This focuses on read-only history exploration, not remote transfer or automatic acceptance of incoming text.

## User job

While reading Matthew, move through earlier versions of the book or the current chapter and see what changed at each point. The historical view must not check out a commit, rewrite the working tree, replace the open Book, or disturb unsaved text. A selected frame is a historical source snapshot displayed in a read-only surface. The current working text remains the current working text.

The v1 [book history loop draft](../../../scripture-editor-proto-2/plans/book-history-loop.md) is a candidate, not evidence of measured latency. Sefer already has a narrower starting point: [`Git.show` and lazy `Git.previousVersions`](../../src/core/git/git.ts) read historical file bytes, and the [History panel](../../src/app/ui/panels/HistoryPanel.tsx) uses that port. The Web layer uses isomorphic-git over OPFS; Tauri delegates Git operations to git2. No chapter slider or verse attribution is implemented here today.

## What Git knows, and what Sefer must derive

Git stores commits pointing to trees and file blobs. Given a commit and Matthew's path, the Git layer can retrieve the book's blob without checking out that commit. We do not scan `.git/objects` ourselves, and a packed object may require its delta base without requiring every historical version to be inflated. Identical book content has the same blob identity, so repeated frames can be skipped. [Git objects](https://git-scm.com/book/en/v2/Git-Internals-Git-Objects), [packfiles](https://git-scm.com/book/en/v2/Git-Internals-Packfiles).

The file is the smallest unit Git can identify here. Git can answer “Matthew changed in this commit” from history or tree identities; it cannot answer “chapter 3 changed” from the book blob ID alone. To make a chapter-specific frame list, Sefer must inspect candidate versions of Matthew, locate chapter 3 in each exact text, and compare that chapter's content or checksum with adjacent frames. Do this at the same chapter semantics as the current text; chapter number, ordinal, missing chapter, and front matter are distinct. A chapter hash is a filter for whether to compute a detailed diff, not a substitute for displaying the exact historical blob.

Reading **one chosen frame** and building **the chapter index for many frames** have different cost profiles:

1. A chosen frame: resolve the commit/path to one book blob, decode and parse it, slice the chapter if requested, then render read-only. Compare with one adjacent blob only when a change overlay is requested.
2. A book frame list: enumerate commits that changed this file. Sefer's current Web `previousVersions` uses an unbounded path-filtered `git.log`; a large history may make this first list expensive. Prefer bounded initial history/paging or an incremental walk after measurement. isomorphic-git's [`log`](https://isomorphic-git.org/docs/en/log.html) accepts `filepath` and `depth`.
3. A chapter frame list: for the candidate book frames, read each distinct blob once, obtain chapter extents and hash their exact bytes, and retain frames whose chapter hash changed. The initial pass is proportional to distinct Matthew versions inspected, even if the reader ultimately sees only chapter 3. Build it on demand, never during project open.
4. Scrubbing: keep a small LRU of decoded blobs and parsed chapter tables, memoize adjacent diff results, and prefetch neighboring frames after the selected frame appears. Bound memory; historical books should not become resident editable Books.

The first UI can show book-changing frames immediately and refine to chapter-changing frames as the chapter index completes. It must say which filter is complete rather than silently omit older chapter changes while indexing. A slider that waits to compute every chapter in every commit before showing its first frame has the wrong latency shape.

## Proposed first increment

Start with **book time travel**: a read-only historical pane, a bounded initial list of versions touching the selected book, and “previous/next version.” Selecting a version reads the blob on demand and can compare it to the adjacent version or current working text. This proves the essential no-checkout path, exact source decoding, surface lifetime, and user-visible latency with little new Git API. It does not need a new history service or worker up front.

Then add chapter filtering as a separate increment. Use the current TOC or the proposed Sefer Location module to identify chapter extents in each historical blob. Cache by `(repository identity, book path/blob ID, chapter number)` or another key that proves the exact text, and invalidate the frame index when HEAD or the selected history ref changes. Decide whether the selected chapter is fixed by number while scrubbing, and make “this version has no chapter 3” an explicit frame state. Renamed book files are a history boundary until a deliberate path-following rule exists.

No restore action is implied by the slider. If a later workflow copies historical text into working text, it should enter the existing Compare/Review and Book write path with its own confirmation and recovery contract; a Git checkout is not that action.

## Attribution is a different feature

“Show changes to this passage over time” is useful without claiming who personally performed each edit. Git's normal blame is line based and reports the commit and **author** that last changed a line; merely merging an unchanged line does not automatically transfer authorship to the merger. It does not establish the human translator when work was squashed, a conflict was resolved by someone else, commits use shared identities, or verse content moved or was renumbered. [Git blame](https://git-scm.com/docs/git-blame).

The v1 draft proposes verse attribution from adjacent diffs. Keep that as a possible later investigation, with a more cautious label such as “commit that introduced this wording.” Merge parent choice, renames, moved text, structure-only edits, and incomplete/shallow history need explicit semantics. Do not build or promise verse blame as part of the first slider.

## Worker and performance decision

Git network I/O is not the slider's main-thread concern. On the Web, isomorphic-git's object decoding, a long path-history walk, repeated TOC construction, and many chapter diffs may use enough CPU to affect interaction. Tauri's Git implementation runs through native commands and has a different cost profile. Asynchronous APIs alone do not prove the browser remains responsive.

Do not start a worker at project open and do not pre-index every book. Measure on representative long and ordinary histories: time to first frame, time to first book frame list, time until chapter filtering is complete, scrub-to-paint latency, main-thread long tasks, memory peak, number of distinct blobs read, and performance after a second visit. If chapter indexing visibly stalls the Web UI, move that bounded indexing job behind a worker boundary. Keep the Git port and results the same; do not add a separate authoritative history store merely to hide the cost. A single historical blob read and render should remain simple unless measurements show otherwise.

The v1 draft's “sub-second after pack inflation” and “roughly a day” are estimates, not acceptance evidence. The test repository should include hundreds or thousands of commits, repeated commits that leave Matthew unchanged, a long Matthew history, chapter-local and cross-chapter edits, a bridge, a book rename, and a merge. A small fixture can prove semantics; a real large repository must answer latency.

## Connection to collaboration

If discussion threads later live in D1, a history frame can ask for threads associated with the repository identity, commit ID, and passage anchor. Load them after the text frame, and keep their access rules in the discussion service. The frame's commit ID identifies the historical text; the thread's durable ID and original anchor identify the discussion. A comment on current text may separately have a mapped current location. This does not require Git notes or embedding discussion data in USFM.

## Separate remote-state question

A fresh remote branch tip equal to the local tip means those tips agree. Different tips alone do not reveal ahead, behind, or diverged; that needs commit relationship information after fetch. Sefer's [sync state](../../src/core/sync/state.ts) already models that distinction. A background update check may be useful, but it is independent of historical indexing and is not a reason to build a worker. Fetching can update remote-tracking refs without replacing the working tree; receiving files into an open Book needs its own reconciliation gate.

## Decisions before dispatch

1. Is the first user view book-wide history only, with chapter filtering promoted after it is measured? Recommended yes.
2. Is the slider's comparison against the previous book-changing frame or the current working text? Both are useful; choose one default, label the baseline, and add the other only if the first view makes the need clear.
3. Does the slider follow the current branch's first-parent history, all reachable commits, or a selected remote/ref? This changes what “previous” means, particularly at merges; decide before building its frame list.
4. What should a missing chapter or renamed book look like in the frame sequence?
5. What latency and memory results would justify a Web worker for chapter indexing? Set the gate from a representative probe rather than from the existence of Git history alone.
