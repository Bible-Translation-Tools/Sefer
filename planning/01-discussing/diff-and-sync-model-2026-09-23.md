# Diff, sync and the Git lifecycle

**Status:** the one working spec, 2026-09-29 (revised 2026-09-30), agreed with Will in conversation. Built on the `git-lifecycle` branch (2026-09-30, unmerged): everything [§2a](#2a-as-built-2026-09-30) lists, with its deviations. The durable account is now in the architecture chapters ([git](../../documentation/architecture/git.md), [sync](../../documentation/architecture/sync.md), [review](../../documentation/architecture/review.md)); this doc keeps the reasoning and what is still open. This doc absorbs:

- the 2026-09-19 "book and chapter time travel" note (`next-git-considerations.md`, now deleted);
- the progress log of the local review and history plan (deleted);
- this file's own 2026-09-23 draft.

The measurements it rests on are summarised in [Appendix A](#appendix-a-measured). Will's voice note is Appendix B.

The flow, top to bottom:

1. A project arrives, and ends up with a healthy repository and a first commit.
2. On open, Sefer may check the shared project.
3. Incoming work is classified against the EDITOR.
4. Policy decides what needs a person's eyes.
5. Receiving moves text through the Book, never under it.
6. Record a version: Save writes the files, one commit records them, and a send may follow.

---

## 1. The goals

From Will's voice note (2026-09-23):

1. **The cheapest possible "are we up to date?"** Compare our latest commit id with the remote's.
2. **Pull only what changed.** If you changed Matthew and I changed Mark, that is two books to read and diff, not 66. Path plus blob id is the ideal; a full clone is only the fallback.
3. **Diff whole files.** The network is the slow part, not the diff. Slicing into chapters makes added and deleted chapters, and the decision units, strange.
4. **Granularity is the engine's decision unit.** Inside a unit, words by default (characters optional), each unit knowing whether it is whitespace-only or markup-only, and each able to flip to USFM.
5. **A change-metadata layer.** Every change is classified by book, chapter and verse and counted per scope. _Overlap_ (both sides changed the same scope) is kept separate from _information_ (something changed).
6. **Policy stays separate from data.** The default is cautious: eyes on everything. Other policies stay possible, such as "accept books the other side changed that I didn't".
7. **Messages people understand.** "Ana changed 12 verses in Mark and Luke on Tuesday." Book names come from the metadata file.
8. **The app's edge for files that aren't USFM,** so Sefer does not become a diff-everything viewer.

## 2. Already built

- **Review is one screen on the engine's decision units**, and the line diff is gone (2026-09-27). `compareBooks` decides `identical` by text equality. History uses engine units and `revertUnits` (`HistoryPanel.tsx:181`, `:242`). `sync/plan.ts` reads the engine's TOC chapter rows, not a `\c` regex.
- **The engine answers what goal 4 asks.**
  - Units report whitespace-only and markup-only (`isWhitespaceChange`, `isUsfmStructureChange`).
  - Word mode is exposed, and Sefer uses `words`.
  - A whole-book diff of the changed units takes 0.5–5 ms. No chapter scope is needed on the diff door.
- **Two-sided change facts:** `src/core/history/delta.ts`. It is a pure projection from a `DiffSkeleton` to changed units and book/chapter-occurrence facts, keeping both addresses, bridges, duplicates and the two kinds of formatting-only change. It has no dependency on Git, the network, authors or policy. [§10](#10-change-facts-and-policy) builds on it.
- **The history prototype** (commit `fa599e2d`, dev-only `/playground/history-diff`):
  - `src/dev/playground/bookHistory.ts` walks raw trees, reads blobs by id, and follows git's default simplification. It matches native `git log -- 01-GEN.usfm` exactly.
  - `history/packView.ts` is the pack-cached filesystem view.
  - `history/bookIndex.ts`, `indexStore.ts` and `indexWorker.ts` build the book-change index in a worker (under a shared Web Lock) and store it.
  - `src/core/history/window.ts` holds the bounded LRU.
  - Also built on the spike: common ancestor, changed-on-both-sides facts, and author in the index.

## 2a. As built (2026-09-30)

On the `git-lifecycle` branch, in the order agreed (lanes, facts and policy, host ops, receive and combine, recording and intake, the app, suggested changes). Verified end to end on the Web against the sandbox `Will_Kelly/x-en-ulb`: clone, the check on open (probe, ~450 ms when nothing changed), send on save, receive into open Books, a refused send reading `diverged`, Combine as a two-parent commit, a contested Matthew settled through Review with both people's changes in `41-MAT.usfm`, the per-passage labels, and the suggestions card as the owner. **Not verified:** forks and pull requests (they need a second account), Web Locks across two tabs, and the desktop app at runtime (the Rust compiles; `cargo test` runs nothing, because the Rust tests were removed on 2026-09-26 under the no-new-tests rule).

**Built as specified:** [§5](#5-intake) intake with the allowlist and the arrival commit, the `.sefer/` exclude, `master` as the default, the device-local name; [§6](#6-the-repository-lifecycle-and-the-one-writer) the lifecycle and lanes; [§8](#8-sync-settings) the four settings and connectivity as one signal (`src/app/syncStatus.ts`); [§9](#9-the-check-on-open) the check on open, probe first; [§10](#10-change-facts-and-policy) facts and `judge`; [§11](#11-receiving) receive through `takeDisk(book, "incoming")` and the decision commit; [§12](#12-record-a-version-save-then-commit) Record a version with the metadata receipt and a person as author; [§13](#13-choosing-a-shared-project) "the shared project" as a Review source, and suggested changes.

**The fresh-eyes review (2026-09-30), and what changed because of it:**

- **Settling in Review records the project's text, not the verdicts.** The first build judged each book by its text and lost decisions both ways. Now every passage has a preset side (theirs for changed there, mine for changed here), a passage changed in both places must be chosen, and every book the review showed is settled as the project holds it — decisions, presets and anything typed into the cards. `receive` and `combine` take `settled` book ids in place of `reviewed`.
- **Burrito checksums in Combine.** `metadata.json` is derived, never contested: the combine takes theirs, recomputes the checksums over the combined files and records it, with every decided save's `also`.
- **Suggestion refs live at `refs/sefer/pull/<n>`**, because the Web's pruning fetch cleared `refs/remotes/origin/pull/<n>` before receive or combine could read it.
- **The Books take incoming text before the files move**, all or none in one synchronous step that re-resolves each Book and checks its stamp, so neither typing nor opening a book mid-receive can make a later save revert the other side; a failed checkout gives the text back. Baselines then follow every file, with failures listed. Receive refuses `unrecorded` and `moved` up front.
- **Honest outcomes:** a settle whose save or commit failed says so; a combine recorded but not sent says that; `/cloud` names books to reopen for.
- **Waits:** receive and Combine fetch before taking the exclusive lane; a transfer that stops moving ends (60 s without a byte on the Web, libgit2's read timeout on desktop); lanes close before the project does.
- **Auto-sync after a network failure:** check on open and send on save ask whether an interface is up, not whether the last transfer failed, so one blip no longer switches them off.
- **Small:** a failed commit leaves the index untouched on both hosts; adoption keeps `.git/index`; an `unhealthy` repository is looked at again on the next write; a stale suggestions load cannot land on another project's card.

**Where it differs from the text below:**

- **The history index ([§7](#7-the-history-index)) is built on the Web only, and without shallow clone or deepen.** `src/core/history/bookIndex.ts` (pure, over an `ObjectReader`), answered by isomorphic-git through the pack view in a worker (`src/platform/web/history/`), stored at `/sefer/history/<root>.json`, extended when HEAD moves. The Web Git layer's `log(path)` and `previousVersions` for a top-level book read it, and `show` reads raw trees, which fixes §15's 13 and 14. Desktop keeps git2's native walk, which has neither bug. The sync path still uses `Git.mergeBase` and `changedPathsBetween`; the index's merge base is not wired, because nothing needs it yet. Shallow clone and deepen are built in the smaller form agreed on 2026-09-30: the caller chooses `history: "latest" | "all"` on clone (Web default `latest`, desktop `all`, reference texts `latest` everywhere), and History deepens in one fetch the first time it opens on a shallow project, with a retry button. No background worker, no chunks, nothing downloaded for a project whose History is never opened. Verified on the sandbox: shallow clone, send, receive and deepen, and the index matching the server's 35 commits afterwards.
- **No Rust mutex.** Tauri runs non-async commands one at a time; the one writer is the TS lane on both hosts.
- **The adoption allowlist keeps `refs/tags`** as well as `refs/heads`.
- **A lifecycle refusal on `Remote` is `Rejected`**, and on `Git` `Refused`, so no caller's error handling changed.
- **`sync.receive` is a note, not an operation**: it runs inside the transfer or check that asked for it. The lifecycle writes `repository.*` notes. There is no `deepen` and no `probe` operation; `sync.check` covers the probe.
- **The sync settings live on `/cloud`**, not `/settings`, beside the state they change.
- **git2 went from 0.20 to 0.21** (Will's OK), which fixed 0.20's `Remote::list()` returning a null slice for an empty repository.
- **401 and 403 are both `Unauthorized`**, so the copy names both: "this account may not have permission to write to the shared project, or its sign-in has expired".
- **Combine takes `reviewed`** (and receive too): after Review has settled the contested books, their text is the decision and the refusal does not apply. `theirs` points either at a suggestion's head.
- **Unrecorded work no longer refuses Combine.** Nothing is checked out over it; the files that arrive are only ones this device did not change, saved or unsaved.
- **Suggested changes are isolated** so the topology can come out: `core/remote/suggestions.ts`, `app/suggestions.ts` and `SuggestionsCard.tsx`, joined at four one-line seams. With the seams cut, `pnpm deadcode` reports the three files unused (checked 2026-09-30). See [git](../../documentation/architecture/git.md#suggested-changes).
- **Not built yet:** the unhealthy-repository copy and its Advanced tools ([§18](#18-resolved)); the Advanced / troubleshooting panel; `@codemirror/merge` for non-scripture files ([§4](#4-the-shape-of-every-comparison)), so the sid-aligned invariant is unchanged. From [§17](#17-small-todo-list-while-in-there), the kebab's "Save", the Review dev copy and `DEFAULT_BRANCH` are done; the copy suggestions wait for the PO pass.

## 3. Rules that are settled

- A Book's file is written only by Save, and Save runs only inside Record a version (Save, then one commit). The one exception is a receive's checkout of a fast-forwarded commit ([§11](#11-receiving)), which then hands the Book its new text through the funnel. The Journal is the only automatic write.
- Scripture text is never merged automatically. Git's fast-forward is one policy among several, and not the default one.
- Only what Sefer wrote reaches a commit. The receipts come from Save, from import (the arrival), and from the burrito checksum refresh.
- Each host has its own implementation behind one port: isomorphic-git over OPFS on the Web, git2 on desktop. Desktop is the end goal and the Web is first-class.
- Nothing transfers as a side effect of editing. A transfer follows only an open or a save, through the two network settings ([§8](#8-sync-settings)). They are on by default, each can be turned off, and each names what it will send before it sends.
- Every new code path follows [observability](../../documentation/architecture/observability.md): one operation per gesture or background job, spans for the hops, counts and timings, and never content, URLs or names. That is the runtime evidence for both correctness and performance; one-off measurements are not.

### Words in this spec

It uses the [glossary](../../documentation/glossary.md)'s terms exactly, and follows [sync](../../documentation/architecture/sync.md)'s rule: **core speaks git, and the screen does not.** Quoted copy uses the screen's words; everything else uses these.

| In this spec                                                              | Means                                                                                                  | On screen (`copy.ts`)                                                                |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| Source, Book, Snapshot, Source stamp, Baseline, Journal, Checkpoint, Save | as the glossary defines them                                                                           | —                                                                                    |
| Record a version                                                          | the one action: Save (`saveAll`), then one commit                                                      | "Record a version" (PO copy pass pending, [§17](#17-small-todo-list-while-in-there)) |
| commit                                                                    | the Git object. A Checkpoint is what a person navigates to; a commit is how Git stores it              | "version"                                                                            |
| arrival commit                                                            | the first commit at intake, made from the import's receipts                                            | "Imported from …"                                                                    |
| decision commit                                                           | a commit with two parents whose tree Sefer wrote from a person's decisions; git's merge never runs     | "combined" / "Combine"                                                               |
| merge base                                                                | the common ancestor of our tip and theirs; it labels who changed what and is never shown               | —                                                                                    |
| the remote; `receiveFrom`, `sendTo`                                       | the remote's two roles ([§13](#13-choosing-a-shared-project)). Never "source": Source is a Book's text | "the shared project"                                                                 |
| fork                                                                      | a Gitea fork of canonical under the translator's account                                               | "your own copy"                                                                      |
| pull request                                                              | a Gitea pull request from a fork's `master` to canonical's; one open per person per project            | "suggested changes"                                                                  |
| steward                                                                   | anyone whose account can write to canonical; not a stored role                                         | —                                                                                    |
| fetch · fast-forward + checkout · push                                    | the three transfers                                                                                    | "check for changes" · "receive updates" · "send my changes"                          |

"Version" is never a term in this spec's prose. The glossary says to avoid it for Save, Recovery and Checkpoint alike, and Cloudflare uses it for something else. It appears only in quoted copy, where the screen already says it for a commit.

## 4. The shape of every comparison

Whatever the two sides are, a comparison goes through the same stages:

1. **Identity.** Each side lists its files with a content id:
   - a Git tree's blob ids;
   - `hashBlob` over a folder's or zip's own bytes. Never over LF-normalised text, which is not the same blob when the line endings or BOM differ.
   - the `SourceStamp` for the live editor against its baseline.
2. **Which files differ.** An id comparison with no reads. A file present on one side only is an added or removed book.
3. **Read only those.** For Git, read the changed blobs after a fetch that moved only new objects.
4. **Diff each changed book whole** with `galley.diff`, giving decision units.
5. **Classify** the units into change facts (book, chapter and verse; text, markup or whitespace), two-way or three-way.
6. **Policy** decides what needs a person's eyes. The default is everything.
7. **Present** the result in plain words, with word detail per unit and a USFM toggle.

**Files that aren't USFM come in three tiers, and none is ever merged automatically.**

| Tier | What                                                          | How it's handled                                                                                                                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | USFM books                                                    | Everything above.                                                                                                                                                                                                                                                                                 |
| 2    | Metadata Sefer understands (`metadata.json`, `manifest.yaml`) | Derived fields (ingredient checksums, book lists) are regenerated from the accepted books first, never merged, so a checksum-only difference never reaches a person. Nothing hand-edits metadata once rename moves out ([§5](#project-name)). Anything still different is treated as tier 3 text. |
| 3    | Every other text file                                         | Read-only side-by-side text diff; pick one whole side. Binary files: pick one side, no diff.                                                                                                                                                                                                      |

**The text fallback is CodeMirror's own merge view, not a form per file.** `@codemirror/merge` (not installed yet) has `MergeView`, a side-by-side view of two documents with the changed chunks marked. For tiers 2 and 3 it is read-only, with two buttons: keep this device's file or take the shared project's. There is no accept-per-chunk, because that would be a merge. JSON is shown pretty-printed with sorted keys so that key order and whitespace don't show up as changes, but the side picked is written back as its original bytes.

- This is a deliberate, scoped exception to "the engine is the only diff" (sid-aligned-diff memory). It applies only to files that are not scripture, sits behind Advanced, and is expected to be rare. Scripture never goes through it.
- It is a simpler start than dedicated metadata forms. The per-field decode through `core/resources` stays possible if a real case asks for it.

Renamed book files don't matter, because books are identified by their `\id` line (`identifyBook`), not by their path.

## 5. Intake

Whatever it arrives from, a project ends up with a repository, on one branch, and a first commit that covers exactly what arrived.

| Arrives as                  | What intake does                                                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Zip or folder, no `.git`    | Copy, `init` on `master`, then an arrival commit from the import's receipts                                                         |
| Zip or folder with a `.git` | Copy, [adopt](#adopting-an-existing-git), then an arrival commit only if the files differ from HEAD                                 |
| Remote                      | `clone`, which creates the repository itself (no init first). Depth 1 on the Web ([§7](#7-the-history-index)). HEAD is the arrival. |

**Where it lives: core.** Adoption, the arrival commit, the index and its upkeep are pure over ports, so they sit in `src/core/git` beside the port and name no library. Only the ports' answers are host code:

- **Adoption** needs a listing and copy (the `FileSystem` port), plus a text parse of `HEAD`, `packed-refs` and refs, which is pure.
- **Its health check** reads HEAD's commit and root tree through the object reader ([§7](#7-the-history-index)).
- **The arrival commit** is `Git.commit` with the import's receipts.

**The arrival commit.** `resources/import.ts` `commit` already returns every file it wrote, and those are its receipts. `SaveReceiptLike` needs only a `path` to be committed; an import has no Source stamp to carry. Today nothing is committed at intake: the first Record a version commits only the books it saved. A 27-book import whose first version touches Mark therefore records Mark alone, the other 26 books stay untracked, and a publish sends one book. The arrival commit fixes that without an exception to the receipts rule. Message: "Imported from <zip name | folder name>". The author is [§12](#12-record-a-version-save-then-commit)'s identity.

**The branch.** A fresh init uses `master`. A clone uses whatever branch the server's HEAD names (`master` on WACS). `DEFAULT_BRANCH = "main"` in `src/platform/web/remote.ts` becomes `master`, and so does `WebGitLive.init`. The branch is hidden from ordinary users and shown in [Advanced](#16-not-now-and-not-foreclosed).

### Adopting an existing `.git`

Keep the history, drop the remote. That is the right default for three reasons:

- The history is the project's value. For en_ulb that is 12k commits, and the history index is built from them.
- The remote can't be assumed: a friend's zip names the friend's remote.
- `.git/config` can carry credentials in a URL (`https://user:token@…`), a credential helper, and hooks. Libgit2 and isomorphic-git run no hooks, but a person who later opens the folder with git's command line would.

So adoption is an **allowlist, not a scrub**. Copy these and nothing else:

- `objects/`
- `refs/heads/` and the non-remote lines of `packed-refs`
- `HEAD` and `shallow`

Then write a fresh minimal `config`. Remotes, remote-tracking refs, upstream config, hooks, reflogs and `info/` (apart from the exclude file below) are all dropped.

Adoption **falls back to a fresh init**, with a notice rather than a question, when:

- `.git` is a gitfile (a pointer to a repository somewhere else);
- a merge or rebase is in progress;
- HEAD doesn't resolve;
- the object store can't be read. On the Web this check uses the raw-tree reader, because isomorphic-git throws `UnsafeFilepathError` on real histories.

The notice: "The history in this zip couldn't be read, so Sefer started a new one. All the files are here." A question would slow intake down, and a person has no meaningful way to answer it. The zip or folder they picked is untouched.

**Idea, not built:** remember the dropped origin URL in provenance as a hint, so choosing a shared project can offer "This came from <host>/<name> — use it?". It stays a hint only, never config.

### Provenance stays on the device

`.sefer/` goes into `.git/info/exclude` at intake: that file is per-repository and is never committed. Provenance means "how this copy arrived on this device". The same project cloned by one person and imported from a zip by another has two true arrivals, and neither belongs in shared history. The friend's-zip scenario needs the project's identity, and that identity is its commits: a zip whose history shares commits with a remote can attach to that remote and move forward from there, whoever made the zip.

### Project name

Rename writes only the device's project index (`src/core/project/projectIndex.ts`, the row's name). The display name is the local name when one is set, otherwise the metadata's name. Nothing in the repository changes, so there is nothing to reconcile when someone else renames: their `metadata.json` name arrives like any other file, and the local name still wins on this device.

This retires two writes:

- `ProjectAdmin.rename`'s edit of `identification.name` (`projectCommands.ts:126`);
- its `.sefer/project.json` fallback.

## 6. The repository lifecycle and the one writer

One service owns "may I touch `.git` now". Its states are `absent`, `opening`, `ready`, `busy(kind)`, `unhealthy(reason)` and `closing`.

**It is a state machine, and needs no library for it.** The transitions are a pure function, `step(state, event) → state | refusal`, in the same style as `sync/state.ts`'s ladder. The service holds the current state in a `SubscriptionRef`, so the sync surface and the Advanced panel can watch it.

- `typeonce-dev/effect-machine` is the idea done well (schema-first, XState-shaped), but it has one maintainer, and its page doesn't say whether it supports Effect 4.
- Sefer is on `effect` 4.0.0-rc.112, and six states with about ten events don't earn a dependency.

- **Lanes.** Reads take a shared lane and mutations take an exclusive one. The mutations are commit, fetch, a deepen chunk, a branch move, a checkout, adoption and init. The object reads for History and the check's classification take no lane: they read immutable objects.
- **Web:** Web Locks (`navigator.locks.request`), one lock name per repository root, shared across the page, workers and **tabs**. They are wrapped as an interruptible Effect acquire and release. The prototype's `indexWorker.ts` already takes a shared lock this way.
- **Desktop:** a per-repository mutex in Rust, taken inside every mutating command.
- **Waits are bounded by design.** A deepen takes the lock per chunk, so Record a version waits at most one chunk. Every wait is a `repository.lock` span carrying `lock.wait_ms` and `lock.kind`.
- **Unhealthy** means `open` failed, a merge was left in progress, or a mutation failed partway. The sync surface says so and offers Finish the transfer or the Advanced tools. It never retries on its own.
- **The Web pack view** (`packView.ts`) lives inside `WebGitLive` and is invalidated by every exclusive-lane release. That is why it belongs to this service.

## 7. The history index

Book level only. It is built as the prototype builds it, and moves behind the Git port.

- **The walker and the index are pure core, over a batched object reader.** The reader has two methods:
  - `commits(from, limit)`: commits in walk order, each with id, parents, time, author, subject and its root tree's top-level book entries (path → blob id);
  - `blob(id)`.

  Batching is what lets one algorithm serve both hosts:
  - The **Web** answers in the worker, over isomorphic-git's `readObject` through the pack view (37 s → ~2 s).
  - **Desktop** answers with git2 in one IPC call per batch of a few hundred commits, rather than one call per object, which would throw away native speed.
  - The walk, git's default simplification, the index format, forward and backward growth, and the rebuild rule are one core module, tested once, against the same fixtures and against native `git log -- <path>`.

- **Our own pack reader stays out.** That is a 300–500-line replacement for isomorphic-git's parser. The pack view above is in; the reader waits until it is earned.
- **Shallow, then deepen, on the Web.** The clone uses **depth 1**. A dedicated worker then deepens in chunks (`fetch({ depth, relative: true })`), taking the exclusive lock per chunk. The chunks are also where it can be cancelled. The timeline says older history is still arriving. Desktop clones in full.
  - Depth 10 was only the spike's choice (≈1.3 s against ≈9 s for a full en_ulb clone). The bytes are nearly all the current books' blobs, which depth 1 fetches too, so 1 costs about the same and lets the project open soonest.
  - Nothing on the open path needs more than the tip. The check on open finds its common ancestor at our tip or above it ([§9](#9-the-check-on-open)). A push from a shallow repository is fine, because the server holds the boundary commits.
  - Until the first chunk lands, History shows one Checkpoint and says more is arriving.
- **The index grows both ways.** Forward at each fetch, as the prototype does, and **backward at each deepen**, from the shallow boundary. So the format records the tip it was built from AND the boundary commits it stopped at. When the stored tip is not an ancestor of the new one (a force push), the index is rebuilt.
- **Where it lives:** beside the project on the device, never inside `.git`. It can always be rebuilt from Git.
- **The job is core; the worker is glue.** Building, extending and deepening the index is one Effect program in `src/core/git`.
  - It is IO-bound and interruptible, and its requirements are only ports: the object reader, `FileSystem` for the stored index, and the lane.
  - The Web worker builds those layers (isomorphic-git over OPFS through the pack view, Web Locks), runs the program, and relays progress and cancellation over `postMessage`. Cancelling is `Fiber.interrupt`, which lands at the next chunk boundary.
  - Desktop runs the same program in the webview, not a worker. git2 does the heavy reading, and Tauri's `invoke` is not expected to be reachable from a Web Worker (to verify).
- **Chapters are on demand.** Only "show me the history of Genesis 3" needs chapter data for every commit that changed the book. It is built when asked, cached per (blob, chapter), and says how much it has covered.
- **"Previous" at a merge** follows git's default simplification, as the prototype does and as native `git log -- <path>` does. First-parent would hide changes made on merged branches. The index can support either.
- **What reading history must never do:** check out, rewrite the work tree, replace an open Book, or disturb unsaved text. A historical frame is a Checkpoint, shown through a read-only `CompareSource`. Its default comparison is with the previous commit that changed the book; a comparison with the working text is a second view with its own label. Commit author and time are version history, never proof of who typed the words.

## 8. Sync settings

These are persisted per project, and all four exist even if the designer later folds some into Advanced.

| Setting                         | Kind      | Hook                                                                                    | Default |
| ------------------------------- | --------- | --------------------------------------------------------------------------------------- | ------- |
| Check for changes on open       | network   | project open → [§9](#9-the-check-on-open)                                               | **on**  |
| Send my changes on save         | network   | after a successful save → push, only when the state is `ahead`                          | **on**  |
| Skip review of my changes       | tolerance | saving skips the Review screen                                                          | off     |
| Skip review of incoming changes | tolerance | receive without Review, only for books the [policy](#10-change-facts-and-policy) passes | off     |

The last setting's promise, "unless they touch content you've also edited but not yet saved", holds by construction: "mine" in the change facts is the editor's text, so unsaved work counts.

**The two network settings are on by default,** so the ordinary translator never has to learn the words fetch and push. That is why the "each one names what it will send" rule matters: the Save dialog's last line says "This also sends your changes to <shared project>" whenever sending will follow.

- **Offline** skips both quietly. The next check or save tries again.
- **A send that is refused** is never a save failure: the files are written and the commit is made. The save's toast says "Saved", and the send's outcome is its own line under it, then on `/cloud`.

**Saved but not sent is a state, with its own words.** The survey gains one input: how the last send ended, `none | sent | refused(reason)`. The state machine turns it into the copy through `copy.ts`, the one glossary, like every other state. Each paragraph ends, as every anxious state's does, by saying the work is safe here.

| Why the send didn't happen | State it leaves                    | What the screen says                                                                                                                                                 | Primary action     |
| -------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| Signed out                 | `ahead`                            | "Saved on this device. Not sent: sign in to send your changes to <shared project>."                                                                                  | Sign in            |
| No write access            | `ahead`                            | "Saved on this device. Not sent: you can't write to <shared project>." Only when making your own copy failed or was declined ([§13](#13-choosing-a-shared-project)). | Make your own copy |
| Offline                    | `offline`                          | "Saved on this device. Not sent yet: you're offline. Sefer sends it the next time you save or open this project."                                                    | Send now           |
| The shared project moved   | `checking` → `behind` / `diverged` | "Saved on this device. Not sent: the shared project has new changes. Checking them now…", then that state's own words                                                | that state's       |

There is no retry when the connection comes back. A transfer still follows only an open, a save, or a press.

### Connectivity is one signal

Whether the device is online is one application-wide signal, not something each screen works out for itself.

- **Where it comes from:** `src/app/ui/cloud/network.ts` already keeps `navigator.onLine` live from the window's `online` and `offline` events, for the `/cloud` screen only. It moves up to the composition as one signal, so the check on open, send on save, the Save dialog's last line and `/cloud` all read the same answer. Both hosts' webviews have `navigator.onLine`.
- **It isn't a media query.** CSS has no connectivity media feature. The event pair is the listener.
- **When it says offline,** nothing is attempted. The check ends `declined` "offline", send on save skips, and the copy says so ([the table above](#8-sync-settings)).
- **When it says online,** that isn't proof: a captive portal or a dead proxy also reports online. So a transfer that fails with `RemoteError.reason === "Network"` also sets offline until the next `online` event. These are the two detectors `sync.md` already describes, now shared.

## 9. The check on open

Checking is never the same as pulling. It runs in the background and first load never waits for it.

1. **Probe.** A new `Remote.probe(url)` reads only the refs (isomorphic-git `getRemoteInfo`, git2 `ls-remote`). It answers `{ reachable, defaultBranch, head, empty }`. If the remote's head equals our tracking ref and our HEAD, the check is done: `sync.check` ends `passed`, `sync.check.result: up-to-date`.
   - The same primitive also serves [paste a URL](#13-choosing-a-shared-project) and the clone door's "can we use this?".
   - **It is an input behaviour, not a screen.** Any URL field can take it: import, attach, "get work from", and Advanced's remotes. It probes after a pause in typing and says, under the field: "Sefer can use this: <branch>, <n> versions", "This is empty — you can send to it", "Sign in to <host> to use this", or "This isn't a project Sefer can download". Core answers the question through `Remote.probe`. The field's behaviour is one UI primitive, wired once, and it goes through the same content-host mapping as `attach`, so a proxy URL and a content-host URL give the same answer.
2. **Fetch.** Only the default branch, under the exclusive lane. The objects land in `.git`, the tracking ref moves, and no project file changes.
3. **Classify, three-way, per book.** The **merge base** is the common ancestor of HEAD and the tracking ref, found over the index's parent links. "Theirs" is the tracking ref's blob. "Mine" is **each Book's current Source**, taken as a Snapshot with its Source stamp and compared with the merge base, so committed-but-unsent work and unsaved work both count.
   - A root-tree comparison narrows the set first: base → HEAD, base → theirs, plus dirty books.
   - Only candidate books get a whole-book `galley.diff` against the base, in `words` mode.
   - This step takes no lane and runs on the main thread: it is object reads plus a few milliseconds of engine work.
4. **Facts → policy → state.** The survey feeds `sync()` a new input: the policy's per-book answer.

**While it runs,** the sync state is `checking`, a new rung second in `syncStateOf`'s ladder: after `conflicted`, which still outranks everything, and before `offline`. Push, receive and Combine are refused with that reason, and a push waits for the check's result rather than racing a check that is about to say `diverged`. Editing and saving are unaffected, apart from the one-chunk lock wait.

**When the common ancestor isn't here yet.** After a shallow clone that is almost never true. Our own commits sit on top of what we cloned, and a fetch brings the remote's new commits down to a commit we hold. It happens after a force push that rewrote old history, and in one ambiguous case: shallow history can't tell "no common version" from "not downloaded yet".

**Decision:** block receiving and the decision commit in that case, not the app. The worker moves that repository's deepen to the front of its queue. Copy: "Changes are waiting in the shared project. Sefer is still downloading older history to compare them with yours." Once the history is complete and still has no common version, the state is `diverged` with `sync.merge_base: none`. That is the existing no-common-ancestor rule.

## 10. Change facts and policy

**Facts** are pure, in `src/core`, and have no dependency on Git, the network, the UI or authors. The three-way facts are two runs of `delta.ts`'s two-sided projection, base → mine and base → theirs. Per book: `{ mine, theirs }`, each `unchanged | changed(chapters, units)`, plus `presence` (added or deleted on either side). Chapter and verse come from the units' addresses. There is no slicing and no regex.

**Policy** lives in one findable file, `src/core/sync/policy.ts`. It is a pure function of the facts and an overlap scope, `"project" | "book" | "chapter" | "verse"`. The default is **`"book"`**: a book changed on both sides needs review, which is what git would call any change to the same file.

```ts
type Overlap = "project" | "book" | "chapter" | "verse";
type BookVerdict = "take" | "review"; // take: only theirs changed; review: overlap at the scope, or policy says so
const judge = (facts: readonly BookFacts[], overlap: Overlap): readonly BookVerdict[] => …
```

Everything else reads the policy's answer and never derives overlap on its own: the state machine's `contested`, whether a receive goes straight to a decision commit or through Review first, the auto-receive setting, and the copy. `combinePlan`'s per-file intersection for non-book files stays as it is. The incoming plan's chapter rows (`sync/plan.ts`) become a view over these facts, not a second computation.

**Copy** states facts. The word "conflict" never appears. It leads with chapters and gives verses in the detail.

- **Headline:** "You have changes in 4 chapters of 2 books that aren't saved yet. The shared project has changes in 6 chapters of 3 books. One book, Mark, changed in both places."
- **Changed there only:** "Luke: 3 chapters changed in the shared project. You haven't changed Luke."
- **Changed in both places:** "Mark changed in both places. The shared project changed chapters 2 and 5; you changed 5 and 9. Review before receiving."
- **With a name, when commit metadata has one:** "Ana changed 12 verses in Mark and Luke on Tuesday." This is labelled as version history. A zip or folder gets the same sentence without the name.

"Review before receiving" is the policy talking. The rest of the sentence is fact.

## 11. Receiving

**The facts are taken from Snapshots, and a receive re-checks them.** The check classifies each Book's Source as it stood when the check ran (a Snapshot, with its Source stamp). Typing continues meanwhile. So a receive first compares each Book's current stamp with the one its facts were taken from. A Book that moved is classified again before anything is written. That is the same stale guard every derived product in Sefer carries (INVARIANTS, "Every derived product is stamped").

**Behind only, and every Book is `take`:**

1. Fast-forward the branch under the exclusive lane: `Remote.fastForward(repo, to)`.
2. Check out only the changed paths. Git writes their Disk bytes exactly as committed, so the work tree equals their commit byte for byte.
3. **Hand each affected Book its new text through the funnel.** This is `SaveCoordinator.resolve`'s existing `takeDisk` path, generalised to `takeDisk(book, origin)` and called with a new Origin, `incoming`. It re-reads the file, submits it as ONE trusted `book.apply` (so the change is in Undo, the editor sees it, and a journal follows), and promotes the new Disk bytes to the Baseline.
   - `adopt` cannot do this, and must not be used for it: it is refused once a Baseline exists or the revision is past 0, which is every Book that was open.
   - Promoting the Baseline in the same step is also what keeps the file watcher quiet. `externalChanges` drops a change that matches the Baseline, so the checkout's own writes are never reported as a conflict.

Nothing does step 3 today. Books are read once at open, `externalChanges()` has no listener in `src/app`, and a pull only refreshes the screen's rows. So after a pull, the next save writes the old text plus the edit back over the incoming change, and nobody is asked. This is the most serious bug this spec fixes.

A `take` Book has no unsaved edits by definition, because its Source equals the merge base's. So step 2 overwrites nothing that isn't recorded, and no journal is lost.

**Any `review` Book, or diverged:**

1. Review gets a new `CompareSource` kind, `remote` ("the shared project"): the tracking ref's blobs, `canApply: false`. It is the "remote latest" source review.md already lists under "Not yet".
2. The decisions write into the editor, as every Review decision does.
3. Record a version then makes **one decision commit**: a commit with two parents (our tip and their tip) whose tree is exactly the final files.

That one path covers both contested and diverged, so both sides' commits are kept, and no scripture is merged by git. Git's merge machinery never runs: Sefer writes the tree itself.

**On screen it is two sides: mine and theirs, at latest.** The merge base is used only to label who changed what; it is never shown as a third column. Review keeps its two sides: "In the editor" on the left, "the shared project" on the right. Each unit carries one label from the base facts: **changed there**, **changed here**, or **changed in both places**.

- The labels are what make a two-sided view safe. Without them, "Keep all mine" on a book would silently undo every change that only the shared project made. With them, the bulk actions can offer "Take everything that only changed there".
- Whether any label is pre-decided is policy ([§10](#10-change-facts-and-policy)). The default pre-decides nothing.

**What history looks like afterwards: only the final text matters.**

- **The decision commit's tree:**
  - every Book's final Source, encoded to its Disk bytes;
  - for every other file, whichever side changed it. That is a pick per file, never a merge of text.
- **Nobody rebases.** This device's 100 unsent commits stay as they are, beside theirs, and the decision commit joins the two. Nothing is replayed commit by commit. Its default message names the books ("Combined with the shared project: Mark, Luke").
- **No force push, ever.** The decision commit descends from BOTH tips, so sending it is a fast-forward on every remote that holds either one: canonical, and your own copy that already has your earlier commits ([§13](#13-choosing-a-shared-project)).
- **Behind only** (no unsent commits here) needs no decision commit: taking everything is a plain fast-forward.
- **The decision commit replaces Combine's squash** (a forced branch move to their tip, then one commit with one parent).
  - The squash worked with one shared remote, but it breaks as soon as your commits are also on your own copy. There, a single-parent commit on their tip is not a fast-forward, and sending it would need the force push this spec rules out.
  - It is also safer: no forced checkout, nothing uncommitted is ever discarded, and a failure after the files are written leaves the decided text on disk (`on disk, not recorded`) rather than a stranded branch.

**What changes on the ports and in code:**

- `Git.commit` takes `parents: readonly CommitId[]` (HEAD alone by default). A decision commit passes two, and bringing in several suggestions at once would pass more ([§13](#suggesting-changes-and-the-steward)).
- `Remote.pull` goes. Receiving is `fetch` plus a new `Remote.fastForward(repo, to)`, which refuses anything that isn't a fast-forward on both hosts. The Web `pull` calls isomorphic-git's `git.pull` without `fastForwardOnly`, and the comment above it claims the opposite, so the two hosts disagree today. Desktop's `git_pull` already refuses a divergence.
- `Remote.moveBranch` loses its only caller, `combine.ts` steps 4–5, which become "write the final files, commit with both parents".
- Combine's other refusals stay. `contested` stops being a refusal and becomes the way into Review, and `deletion` stays until a receipt can say "this file is gone". `CombineError.state` shrinks to `untouched | on-disk`.

## 12. Record a version: Save, then commit

- **One action.** Save writes the Books' files (`saveAll`), then one commit records them. The kebab offers only Save & Review. "Skip review of my changes" is the only way to save without the screen.
- **Receipts include the burrito checksums.** `refreshChecksums` rewrites `metadata.json` on every save of a burrito book (`services.ts:282` → `projectAdmin.ts:435`), but the commit stages only the book receipts. Today every save leaves `metadata.json` modified and unrecorded: Combine then always refuses with `unrecorded-work`, and a desktop pull force-overwrites the file.
  - The fix: `onSaved` returns the metadata receipt and it joins the same commit.
  - The checksums are deterministic from the final books: md5 over each book's bytes as written.
- **The sequence, whenever books change:**
  1. Get every changed book file to its final bytes (a save writes them; a receive fast-forwards and checks them out).
  2. md5 each burrito book file.
  3. Update the ingredients in `metadata.json`.
  4. Write it.
  5. Commit it in the same commit as the Books.
- **On receive,** Sefer and any other correct tool compute the same md5 from the same bytes, so their `metadata.json` already matches and the fast-forward needs no commit of ours. If another tool left the checksums stale, the fix is **not** a commit of its own. That would make the project `ahead` after every receive, and "Send my changes" would push a change nobody made. The stale checksums are corrected in the next Record a version's commit instead.
- **The author is the signed-in account**, from the Gitea session's username and `/api/v1/user`'s email. This replaces the four hard-coded `Sefer <sefer@localhost>` sites: `ReviewPanel.tsx:88`, `CloudScreen.tsx:68`, `web/remote.ts:78` and `git.rs:236`.
  - **Signed out, a name is required once per device.** It is asked the first time Record a version runs (one field, "Your name, as your team knows you"), and stays editable in Settings.
  - The email may be empty. Git allows an empty author email, and a made-up `@localhost` is worse than none.
  - Once signed in, the account's name is used and the local name stays as the fallback.
  - The save waits only for that one question, never for sign-in.
- **The message gets a default built from the change facts**, for example "Edited Mark 2, 5; Luke 1". The field says why a message matters: "What did you change? Your team sees this, and so will you later."
- **No trailers for now.** Nothing needs them. Book and chapter facts come from trees, which every client writes truthfully, whereas a trailer is a claim only Sefer would make. If one is ever added, it is a hint that nothing depends on.
- **Send my changes on save** pushes after the recording succeeds, only from `ahead`. A server rejection surfaces as `Rejected`, which needs desktop's push-rejection fix ([§15](#15-bugs-this-work-fixes)).

## 13. Choosing a shared project

### Where you receive from, and where you send to

A remote has two jobs, and today one `origin` does both: the remote you **receive from** and the remote you **send to**. For the person who can write to the shared project, they are the same. At an event, most people can't, and an admin adding persons A, B and C as editors of a repository is exactly the friction to avoid.

**Decided: two roles, and the send-to remote is chosen by permission.**

In the model these are `receiveFrom` and `sendTo`, never "source" and "destination": in this codebase **Source** means a Book's canonical text (glossary).

- **A catalogue clone attaches the canonical project as `receiveFrom`.** It is always readable, because WACS content is public, so checking for changes and receiving work for everyone with no setup.
- **On the first send,** Sefer asks Gitea whether this account can write to it (`repos/{owner}/{repo}` → `permissions.push`).
  - If yes, `sendTo` is the same remote. This is the pre-event path: an admin adds the team as writers, and everyone sends to and receives from `master` directly.
  - If no, Sefer offers to make **your own copy**: a Gitea fork under your account, through the existing `Gitea.forkRepo`. It becomes `sendTo`, and the send goes there.
  - Copy: "You can't write to <shared project>, so Sefer made your own copy of it and sent your changes there. Your work is saved online, and nothing in <shared project> changed."
- **One line on screen,** always. "Shared project: <canonical>" while the two roles are one remote, and "Shared project: <canonical> · your changes go to your copy" when they differ. There is no list of remotes.
  - `/cloud` offers **Disconnect**.
  - Advanced offers **Change shared project**.
  - More remotes than these two wait ([§16](#16-not-now-and-not-foreclosed)).
- **Nothing is attached by default for zip, folder and new projects.** Their first send goes through [the chooser](#the-chooser).

Both paths coexist: a team with write access never sees a copy, and a team without it never needs an admin. Everything else in this spec works either way.

### Suggesting changes, and the steward

**Nobody tracks anybody automatically.** A translator sees their own work and the shared project, never six other people's copies. Bringing work together is **explicit on both ends**.

**The words:** the spec's noun is a Gitea **pull request**. On screen it is "suggested changes": the translator's button is "Suggest my changes to <shared project>", and the steward's card is "Suggested changes (3)". Neither side ever sees "pull request". The pair reads as one action from two chairs, and "suggest" says what it is: the translator's text doesn't change canonical until the steward takes it.

- **The translator suggests.** The button opens a pull request from their copy's `master` to canonical's `master`.
  - **One open suggestion per person, per project.** It follows the copy, so a later send updates the same suggestion rather than making a second. There is no stack to manage.
  - It is a button, not a side effect of sending. "Send my changes on save" keeps work safe online; suggesting says "I think this is ready".
- **Who sees suggestions:** anyone whose account can write to the remote they receive from, which makes them the steward. Sefer doesn't store a role. It asks Gitea (`permissions.push`) when the project opens with a session, and only then shows the card on `/cloud`, with a count beside the shared project line.
  - The card lists open pull requests (`GET /repos/{owner}/{repo}/pulls?state=open`), one row each: "Ana suggested changes to Mark and Luke — Tuesday".
  - A translator without write access never sees the card.

**What the steward compares, exactly:**

1. **The steward's own side is their editor**, on a project attached to canonical as both `receiveFrom` and `sendTo`. It is the same "mine" as every receive: each Book's current Source, including unsaved work.
2. **Canonical first.** Opening a suggestion runs the check on open ([§9](#9-the-check-on-open)) against canonical. If the steward is `behind` or `diverged`, the card says "Receive the shared project's latest first", and the suggestion waits.
   - This keeps the steward's decision commit a fast-forward onto canonical.
   - It means "the shared project" in the comparison is never stale.
3. **Their side is the suggestion's head,** fetched from canonical itself (`refs/pull/<n>/head`, which Gitea keeps on the base repository; to verify on WACS 1.23). The steward doesn't fetch from Ana's fork.
4. **The merge base** is the common ancestor of the steward's HEAD and that head. It labels each unit "changed in Ana's suggestion", "changed here", or "changed in both places". Review is two-sided as always: the steward's editor on the left, "Ana's suggestion" on the right, both at their latest.

**Bringing it in:**

- **Take everything** from a suggestion that started at the current canonical: a fast-forward to Ana's tip. Her commits keep her name.
- **Take some and not the rest:** Review, then a decision commit with parents [canonical tip, Ana's tip].
- Either way, sending to canonical is a fast-forward. Gitea marks the pull request merged once its head is reachable from `master`, so the steward never closes it by hand, and Ana sees "Your suggested changes were brought in".
- **"Not now"** leaves it open. **"Decline"** closes it through the API with an optional note, and Ana sees the note.

**Ana afterwards:** on her next open, canonical's tip descends from hers, so she is simply `behind`. What the steward didn't take reaches her as an ordinary incoming change ("Mark: 2 chapters changed in the shared project"). She never rebases, and nobody force-pushes.

**Several suggestions.** The first build takes them **one at a time**, each compared with canonical as it is NOW. After the steward brings in Ana's, Ben's shows Ana's changes as "changed in the shared project", and "changed in both places" where the two touched the same verse. It is still final text against final text, verse against verse; the merge base only decides who changed what.

**Bringing several in at once** is possible without changing anything underneath, and waits for a UI:

- The facts generalise: one merge base per suggestion, and per unit, which suggestions changed it.
- The decision is still one final text per unit.
- The record is one decision commit with N+1 parents, which Git allows. Every included suggestion's head is then reachable, and Gitea marks all of them merged.

So `Git.commit` takes `parents: readonly CommitId[]`, not "an optional second parent", and nothing in the facts assumes two sides. What doesn't exist is a Review screen with more than two columns. Review says "An N-way review is not designed", and it stays that way until someone designs one.

**"Get work from…"** with a pasted URL stays the fallback: a copy that isn't a fork, one on another host, or a translator deliberately looking at a teammate's copy. It is read-only.

**Not foreclosed:**

- several stewards (whoever has `push`);
- following a copy without a suggestion (a steward's opt-in, if a team asks for it);
- suggestions on a host with no pull-request API (the URL fallback);
- Gitea's own web screen for pull requests, which works on the same objects.

### The chooser

It is for zip, folder and new projects, and for "Get work from…".

- **Search first, not a list.** A type-ahead against Gitea's `/repos/search?q=&uid=&limit=10` asks the server for one page at a time, and the client never pages through everything. With an empty query, it shows the person's own repositories and recent ones. If there are 20 or fewer, it shows them all at once (the ordinary translator). An admin who can write to hundreds of repositories gets search, not a scroll.
- **Rank likely matches first,** by the project's language code and name from metadata (`en_ulb` for en_ulb).
- **Paste a URL** is the advanced door, and it is shared with intake's clone-by-URL. `Remote.probe` answers "yes, Sefer can use this" (reachable, default branch, empty or not) or "no, and here's why" (unreachable, not a repository, sign-in needed) before anything is attached. This also gets around a slow catalogue or language API when someone knows the exact URL.
- **After a pick,** fetch and say whether the histories are related before recording the attachment. "This shared project has none of this project's versions" is worth saying before the first send, not after it.

## 14. Observability

Names follow the glossary's rule, **`<thing>.<what happened to it>`**, and extend the families that already exist (`import.*`, `sync.*`) rather than opening new ones beside them. Intake is therefore the existing `import.resource` and `import.remote` with more fields, not a new `project.intake`.

| Operation                           | Opened by                                      | Carries                                                                                                                                                                                                                                                    |
| ----------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import.resource` / `import.remote` | (existing) importing a zip or folder / cloning | adds `import.adopted`, `import.fallback` (why a fresh init), `import.shallow`, `import.arrival` (whether an arrival commit was made); notes `repository.adopt` and `repository.init`                                                                       |
| `sync.check`                        | project open, with the setting on              | `sync.check.result` (`up-to-date`, `fetched`, `unreachable`, `waiting-for-history`), `sync.books`, `sync.review`, `sync.take`; spans `remote.probe`, `remote.fetch`, `sync.classify`. `declined` "offline" when connectivity says so and nothing was tried |
| `sync.receive`                      | a receive, reviewed or automatic               | `sync.books`, `sync.reloaded`, `sync.auto` (whether the setting took it), `sync.decision` (whether a decision commit was made); span `repository.checkout`                                                                                                 |
| `repository.deepen`                 | the worker, per project                        | `deepen.chunks`, `deepen.commits`, `deepen.complete`; one span per chunk                                                                                                                                                                                   |
| `index.update`                      | the worker: build, extend or deepen            | `index.commits`, `index.entries`, `index.direction` (`forward`, `backward`, `rebuild`), `index.bytes`                                                                                                                                                      |

**Also:**

- A `repository.lock` span for every exclusive wait, carrying `lock.wait_ms` and `lock.kind`.
- Notes `repository.open` and `repository.close` for the lifecycle's two ends. A move to `unhealthy` is the verdict `failed` on whatever operation found it, with `repository.state: unhealthy`, not an event of its own.
- A send refused by the server is `sync.transfer` (existing) ending `refused` through `remoteVerdict`, with `sync.send: refused` and the reason.

**New verbs** for the glossary's table: `check` (a remote was asked whether anything changed), `receive` (commits reached the work tree and the Books), `adopt` (an existing `.git` was taken in), `deepen` (older history arrived), and `probe` (a URL was asked what it is). `update` already means "a registry now holds this", which is exactly the index.

Never recorded: a path beyond its last segment, a URL, an account name, or any text.

## 15. Bugs this work fixes

Fixed on `git-lifecycle`: all fourteen. 13 and 14 by the history index on the Web (checked on a clone of en_ulb: Genesis, Psalms and Matthew match native `git log -- <book>` exactly, and the oldest Genesis version's bytes match `git show`).

1. Open Books are not reloaded after a pull or Combine, so the next save reverts the incoming work ([§11](#11-receiving)).
2. Web `pull` can merge automatically; desktop refuses. Receive becomes fetch + fast-forward on both hosts ([§11](#11-receiving)).
3. The first commit of a fresh project records only the saved books ([§5](#5-intake), the arrival commit).
4. `metadata.json` checksums are written but never recorded ([§12](#12-record-a-version-save-then-commit)).
5. Rename edits `metadata.json`, which can't be reconciled ([§5](#project-name)).
6. Import copies a `.git` wholesale, with the remote and any credentials in its config ([§5](#adopting-an-existing-git)).
7. Desktop pull force-checks-out over uncommitted files (`git.rs:823`). Gone once receive is fast-forward + checkout of the changed paths, run only after the facts showed no unsaved or unrecorded work in those books.
8. Desktop push has no push-update-reference callback, so a refused push reads as success (`git.rs:842`).
9. The commit author is hard-coded in four places ([§12](#12-record-a-version-save-then-commit)).
10. There is no repository lifecycle and mutations aren't serialised ([§6](#6-the-repository-lifecycle-and-the-one-writer)).
11. The sync state can't see unsaved editor work: `uncommitted` comes from `git status` only ([§9](#9-the-check-on-open), "mine" is the editor).
12. The `remote.pull` and `remote.push` palette commands (`commands.ts:350`) transfer directly, skipping the incoming plan and the second press. They should route to `/cloud`.
13. Web `log(repo, path)` fails on real histories with `UnsafeFilepathError`. History moves onto the object-reading surface ([§7](#7-the-history-index)).
14. Web `previousVersions` walks the whole log with no `depth`. It is retired by the same move.

## 16. Not now, and not foreclosed

For each: what keeps it possible.

- **Branches other than the default.** The port already names branches, and the lanes and index are keyed by ref.
- **Several remotes, switching branch.** The model is already named remotes with `receiveFrom` and `sendTo` ([§13](#13-choosing-a-shared-project)). More than those two — several teammates at once, or a remote per branch — waits. An **Advanced / troubleshooting** panel would show the branch, the remotes, HEAD, whether history is shallow, who holds the lock, and the index's coverage. Its controls come later.
- **Teammate remotes; shared-organisation versus personal-sandbox topology.** The facts are two-sided and three-way over any two refs, not over `origin` specifically. The user roles and journeys come first when a remote plan starts.
- **Verse- or chapter-level policy.** It is one value in `policy.ts`.
- **A UI for metadata edited on both sides** (tier 2, [§4](#4-the-shape-of-every-comparison)).
- **The same project in two tabs.** Web Locks already guard `.git` across tabs. The text itself is not guarded, and a tab could learn from a lock-release broadcast that the other one recorded.
- **Our own pack reader, and its WASM build beside Galley.** The object-reading surface is the seam.
- **The Gitea API as a cold-open bridge,** for the first page of one book's history before local history exists ([Appendix A](#appendix-a-measured)).
- **Two points in time** ("changes since a date") and a **verse-level "commit that introduced this wording"**. Both are index lookups plus root-tree comparisons; neither is promised as personal blame.
- **Discussion threads** keyed by repository, commit and passage anchor, loaded after a history frame. They need no Git notes and nothing in the USFM.

## 17. Small todo list (while in there)

- Delete the kebab's "Save" item (`Toolbar.tsx:262`). It runs the same `book.save` navigation as "Save & Review".
- Delete the dev copy in Review: "{count} book(s) are not in their files yet. Nothing is written on a timer: this writes the files and records the version together." (`ReviewPanel.tsx:954`, `:1061`).
- **Copy suggestions for the PO pass, not a sweep now:**
  - The button: "Save" (it writes the files and keeps a version) instead of "Record a version".
  - The noun stays "version" in History.
  - The exceptional status "on disk, not recorded" becomes "Saved, but the version wasn't kept".
  - The message field: "What did you change?", with the fact-built default.
- `DEFAULT_BRANCH` becomes `master` (`web/remote.ts:73`, `WebGitLive.init`).
- Repoint `src/dev/playground/history/packView.ts`'s comment and `documentation/services.md`'s Git section at this doc when the prototype moves behind the port.

## 18. Resolved

The three questions left open on 2026-09-29, answered as recommendations Will can overturn:

- **Deepening several projects.** One worker holds one queue, and **only the open project deepens**.
  - "Waiting for older history" ([§9](#9-the-check-on-open)) jumps it to the front.
  - A closed project stops at the end of its current chunk. Its index records the boundary, so the next open resumes where it stopped.
  - Nothing downloads for a project nobody has open, which matters to translators on metered or slow connections.
- **Send on save does not check first.** It pushes, and the server's fast-forward rule is the check.
  - A `Rejected` push starts the check on open's steps 1–4 at once, so the screen moves straight to `behind` or `diverged` with the facts. There is no bare error.
  - Without that, every save would cost a round trip for an answer the push gives anyway. This needs desktop's push-rejection fix ([§15](#15-bugs-this-work-fixes)).
- **An unhealthy repository.**
  - Copy: "Sefer can't read this project's version history right now. Your text is safe and you can keep working. Saving still writes your files on your device, but new versions can't be kept right now."
  - "Remote versions" would point the wrong way. Unhealthy means the local history (`.git` on this device) can't be read, so no version can be kept here or sent anywhere. The shared project is untouched.
  - Saving writes the files and skips the commit, which is the existing "on disk, not recorded" state, said honestly.
  - Advanced offers three tools:
    - **Finish the interrupted transfer:** `abortMerge`, only when a merge is in progress.
    - **Rebuild the history index.**
    - **Start a new history:** the files stay, the old `.git` is moved to `.git-unreadable-<date>` rather than deleted, a fresh init is made, and an arrival commit follows.

- **History browsing is not part of this build.** Decided 2026-09-30: Git holds things up underneath rather than being in anyone's face.
  - The prototype stays on `/playground/history-diff`, behind `__SEFER_DESIGN__`, to show the PO what's possible. Nothing of it moves into the main app yet.
  - What this build does need from [§7](#7-the-history-index) is the index as groundwork: its parent links find the merge base for the check on open and for suggested changes, and its per-book changes narrow which Books get diffed.
  - The existing `/history` screen stays as it is.

- **The "Suggested changes" card lives on `/cloud` for now**, with its count beside the shared project line. Decided 2026-09-30. The designer may move it later.

## 19. Proposed tests

**Written down, not built:** the build-out rule holds until behaviour is locked. When they are built, these go into [testing](../../documentation/architecture/testing.md)'s candidate lists.

Each test sits at the smallest seam that owns its risk:

- **Vitest `core` project:** plain TypeScript in Node. Core is written over ports, so the test provides the host part: the in-memory `FileSystem` layer (the one the dev fixture seeds), or a real production adapter where the claim needs one (isomorphic-git over Node's filesystem for the native-git comparison). No mocks of core itself.
- **Browser Mode:** a real browser API (OPFS, Web Locks, isomorphic-git) at module level.
- **Playwright:** the built artifact.
- **cargo:** git2.

None of them asserts how a screen looks.

### Playwright journeys (`e2e/`)

**Harness:**

- **The remote** is a local git smart-HTTP server started by the Playwright config: `git http-backend` behind a small Node HTTP wrapper that adds CORS, with native git on the runner. Bare repositories are seeded per test from `fixtures/small-nt/`, with `receive.denyNonFastForwards` set, so any force push fails the journey. The built app reaches it through the endpoint preference ([configuration](../../documentation/architecture/configuration.md)), so no build flag changes.
- **Credentials** are seeded the way `platform/web/credentials.ts` stores them (localStorage, keyed by host), because a push needs one and a Gitea login is not what these journeys test.
- **Evidence** comes from two places:
  - the **server's** repository, read with native git from Node: its commits, parents and tree;
  - **Export diagnostics**: its project snapshot (HEAD, branch, origin present, unsaved books, the last sync state) and its rings, read with the observability chapter's `jq` recipes. That is the runtime evidence the observability rules require, read from the production build.

**The journeys:**

1. **A zip becomes one whole first commit.** Import a zip of `small-nt` with no `.git`, then save one edited book, then publish. Guard: the server's history has the arrival commit holding every book, and the save's commit on top holding the edited book; the snapshot shows no unsaved books; `import.resource` ends `passed` with `import.adopted: false` and `import.arrival: true`.
2. **Adoption keeps history and drops the remote.** Import a zip whose `.git` has 5 commits and an `origin` with a token in its URL. Guard: the snapshot shows no origin; the server-side count after a publish is 5 plus any arrival; the token appears nowhere in the export. The byte-level checks are Node test 1.
3. **An unreadable `.git` falls back.** Import a zip whose `.git/objects` is truncated. Guard: the notice appears, every book opens, and `import.fallback` names the reason.
4. **A clone opens before its history arrives.** Clone a seeded remote with 50 commits. Guard: the project is editable while `repository.deepen` is still running; afterwards `deepen.complete` is true and `index.update` covers 50 commits.
5. **The headline bug: a receive never reverts incoming work.** The remote advances MRK. Locally, LUK has an unsaved edit. Open with "Check for changes" on. Guard:
   - `sync.check` ends `fetched`, and no project file changes before the receive;
   - after the receive, the editor holds the incoming MRK and LUK's unsaved edit is intact;
   - editing MRK and saving produces a server commit whose MRK contains both the incoming change and the edit.
6. **Changed in both places goes to Review, and ends in one decision commit.** Both sides change MRK, and the local side has 3 unsent commits. Guard:
   - receiving without review is refused (`sync.review: 1`);
   - Review shows "the shared project" as a side;
   - after the decisions and the save, the server's newest commit has exactly two parents, the old remote tip and the old local tip; its MRK equals the editor's text byte for byte; the push was accepted with non-fast-forwards denied.
7. **Git never merges.** Both sides change different books, with review skipped. Guard: every commit with two parents is a decision commit (Sefer's message, and a tree whose books equal the editor's text), and none was made by `pull`. With review not skipped, nothing is received without a press.
8. **Behind only, and no commit is added.** Theirs only, with no unsent commits here; receive. Guard: local HEAD equals the remote tip.
9. **Checksums travel with the books.** In a burrito project, edit and save. Guard: the server commit contains `metadata.json` with the new md5, and the snapshot shows nothing unrecorded afterwards.
10. **A refused send is reported, then explained.** Save with sending on, against a server that has moved on, then against one that refuses the account. Guard: the save reads "Saved" both times; `sync.transfer` ends `refused`; the first moves through `checking` to `behind` or `diverged`, the second stays `ahead` with the no-write-access words; never "sent".
11. **The first save asks for a name once.** Signed out, save twice. Guard: the name is asked once, and both commits carry it as author with an empty email.
12. **A steward brings in a copy.** A fork of the seeded remote carries 2 commits changing MRK and LUK, and its owner suggests them; the steward takes LUK and not MRK. Guard: the steward's "Suggested changes" card lists it, and a translator's shows no card at all; the steward cannot open it while `behind`; after the save, canonical's newest commit has parents [old canonical tip, fork tip], its LUK is the fork's and its MRK the steward's; the translator's next open reads `behind`, and receiving leaves her HEAD at canonical's tip with no commit added; the pull request reads merged.
13. **The URL field says what it found.** Paste a reachable repository, an empty one, and a URL that isn't a repository. Guard: three different answers under the field, and nothing attached until a person confirms.

### Vitest `core` project (Node, host injected)

1. **Adoption allowlist:** over the in-memory `FileSystem`, a `.git` with remotes, remote refs, `packed-refs` remote lines, hooks, a credential helper and a token URL. Guard: only objects, heads, HEAD and shallow survive, the config is fresh, and each fallback reason (gitfile, merge in progress, unresolvable HEAD) is chosen.
2. **The history index against native git:** the core walker over the batched reader, on a fixture repository with merges, a TREESAME merge, a rename and repeated blobs. Guard: each book's history equals native `git log -- <path>` from a `tools/` probe; forward growth, backward growth and the rebuild on a force push each give the same index as building from scratch.
3. **The decision commit:** over the in-memory `FileSystem` and isomorphic-git, a diverged pair. Guard: the commit's parents are both tips, its tree is exactly the final files (per file: theirs-only → theirs, mine-only → mine, both → the decided text), and nothing uncommitted in the work tree is ever discarded, including when the commit fails.
4. **Change facts and policy:** three texts per book in, per-book verdicts out, at each overlap scope. Guard: `book` (the default) sends any book changed on both sides to review; `chapter` passes different chapters of one book; unchanged, added and deleted are all reported; nothing is decided twice (Combine and the state machine read the same answer).
5. **The lifecycle machine:** every state × event. Guard: mutations are refused outside `ready`, `unhealthy` is left only through its tools, and `closing` refuses new work.
6. **Checksums:** md5 over the written bytes, not LF text; an unchanged book leaves `metadata.json` byte-identical.

### Browser Mode

1. **One writer across contexts:** the Web Locks lane from the page and a worker, and from two pages. Guard: exclusive holders never overlap, a save waits at most one deepen chunk (`lock.wait_ms`), and releasing an exclusive lock invalidates the pack view.
2. **The batched reader over OPFS** on a repository with a backslash tree entry. Guard: no `UnsafeFilepathError`, and the same answers as the Node run of test 2.

### cargo (`src-tauri`)

1. **A push the server refuses is `Rejected`** (the push-update-reference callback), against a bare repository that has moved on.
2. **The batched reader in git2** returns the same batches as the Web reader for the shared fixture.
3. **The per-repository mutex** serialises two mutating commands.

## 20. Documents and invariants this spec changes

Each one is updated in the same commit as the code that makes it true, not before. Two of them are invariants, so each is written down here first, as `INVARIANTS.md` asks.

**Invariants (`documentation/INVARIANTS.md`):**

- **"Only Save writes a book."** This gains one exception: a receive's checkout of a fast-forwarded commit writes the Disk bytes Git holds, and hands the Book the new text through `takeDisk(book, "incoming")` in the same step ([§11](#11-receiving)). Intake writing a new project's files is not an edit to a Book, so it is not an exception.
- **"Diffs are sid-aligned … There is no line diff left in Sefer."** This becomes: "Scripture diffs are sid-aligned." Files that aren't scripture may be shown in `@codemirror/merge`'s read-only view, pick one side, behind Advanced ([§4](#4-the-shape-of-every-comparison)).

**Glossary (`documentation/glossary.md`):**

- The naming rule "The Record a version… command is product copy for one Save" becomes "…for one Save followed by one commit", which is what [review](../../documentation/architecture/review.md) already describes.
- New rows: commit, arrival commit, decision commit, merge base, `receiveFrom` / `sendTo`, and the product copy "shared project", "your own copy" and "suggested changes" (the table in [§3](#words-in-this-spec)).
- New observability verbs: `check`, `receive`, `adopt`, `deepen`, `probe` ([§14](#14-observability)).
- The port type `Version` in `src/core/git/git.ts` (a commit plus a file's bytes) collides with the rule against "version" and with Cloudflare's Version. Rename it when the object reader replaces `previousVersions` ([§7](#7-the-history-index)).

**Architecture chapters:**

- **[git](../../documentation/architecture/git.md):**
  - the receipts rule's sources (Save, import, the checksum refresh);
  - `Git.commit`'s `parents`;
  - `Remote.pull` → `fetch` plus `Remote.fastForward`;
  - `Remote.probe`;
  - the object reader;
  - the lifecycle and its lanes;
  - adoption.
- **[sync](../../documentation/architecture/sync.md):**
  - the vocabulary table gains "your own copy" and "suggested changes";
  - "squash onto the remote head → combine" becomes the decision commit;
  - the ladder gains `checking`;
  - the reading gains how the last send ended;
  - Combine's section is rewritten from [§11](#11-receiving);
  - `conflicted` can now only come from a tool other than Sefer, because Sefer never starts a merge;
  - ahead and behind stay a set difference over commit ids, which holds under shallow history because both sides' new commits sit above the boundary.
- **[review](../../documentation/architecture/review.md):**
  - the `remote` `CompareSource` kind;
  - the per-unit labels "changed there / here / in both places";
  - "The incoming-remote reconciliation narrative" moves out of "Not yet".
- **[recovery](../../documentation/architecture/recovery.md):** a receive's `incoming` apply journals like any other edit, and needs no special case.
- **[observability](../../documentation/architecture/observability.md):** the operations table ([§14](#14-observability)).
- **[landing](../../documentation/architecture/landing.md):** Create, once `ProjectAdmin.create` exists, ends with the same arrival commit as an import.
- **[configuration](../../documentation/architecture/configuration.md):** the four sync settings, stored on the device and keyed by project root, never in the repository.
- **[services](../../documentation/services.md):** the Git section's known bugs point at [§15](#15-bugs-this-work-fixes), and each is deleted there as it is fixed.
- **[testing](../../documentation/architecture/testing.md):** [§19](#19-proposed-tests)'s candidates join its lists when the build-out rule lifts.

---

## Appendix A: measured

Measured 2026-09-25/26 against `WycliffeAssociates/en_ulb`: 11,998 commits, 269 merges, 66 books; Genesis changed in 156. Headless Chrome 153 through the CDP rig, on one macOS arm64 machine, mostly single runs, on the dev server rather than a build. The runs used a disposable worktree (`~/.codex/worktrees/history-metadata-spike/Sefer`, with its notes in `planning/scratch/history-metadata-spike.md`).

This is carried over whole from the local review and history plan, which is now deleted. Its "primitive" numbering is the plan's, and this spec's sections supersede it: [§7](#7-the-history-index) takes primitives 1–4, and [§9](#9-the-check-on-open)–[§11](#11-receiving) take 5a–6c. Primitive 6 remains out of scope. What follows is the record of what was measured, not the plan.

### What broke, and the fix in the spike

- **The Web port's path history is broken on real corpora.** isomorphic-git 1.42.2 parses every tree it walks and throws `UnsafeFilepathError` on a tree entry name git accepts (`00-About_the_ULB\ULB-Intro.md`, in the 2018 commits). One throw loses the whole result; `force`/`follow`/`depth`/`since` do not help, and `readBlob` with a `filepath` fails on those commits too. So `Git.log(repo, path)`, `previousVersions` and `show` cannot serve History on the Web as they stand. Desktop's git2 is not affected.
- **The spike's walker** (`src/dev/playground/bookHistory.ts`) reads trees as raw object content, parses only the path's entries, reads blobs by id, and applies git's default history simplification (a merge TREESAME to a parent follows only that parent). It returns exactly the 156 commits native `git log -- 01-GEN.usfm` does, in the same order. It is an async generator: the first comparison was on screen in ~300 ms, before the walk had gone far.

### Where the Web time goes

Full Genesis walk, 8,878 commits visited (~17.7k objects: commits plus root trees):

| Setup                                                                |          Walk | Filesystem calls                           | JS heap peak over baseline |
| -------------------------------------------------------------------- | ------------: | ------------------------------------------ | -------------------------: |
| Native git (`git log -- 01-GEN.usfm`)                                |        0.11 s | —                                          |                          — |
| Node, isomorphic-git, native fs                                      |         6.7 s | 88k calls, 5.4 s                           |                          — |
| Chrome, OPFS (as the page runs today)                                |       37–39 s | 88k calls, ~36 s; CPU profile 72% idle     |                   +30.5 MB |
| Chrome, repeat calls memoized                                        |        13.6 s | 17,680 loose-object probes, 11 s           |                          — |
| Chrome, pack files in memory, loose probes answered from one listing | **2.1–2.4 s** | 7 calls; loading the 16 MB pack took 27 ms |                    +8.7 MB |

- The gap is **isomorphic-git's per-object filesystem probing**, not JS speed: for every object it lists `objects/pack`, stats, reads `alternates`, and tries a loose-object path that is not there — about five calls, each an OPFS async round trip that walks path segments with `getDirectoryHandle` (~0.5–0.8 ms). Its `cache` argument does not stop this.
- What remains at ~2 s is real compute (JS zlib inflate, delta application, Buffer churn) — the ~12–20× still separating it from native git.
- isomorphic-git already holds the **whole pack file in memory** once it reads any packed object (`p.pack = fs.read(packFile)`): 14.5 MB pack + 1.5 MB `.idx` for en_ulb, outside the JS heap, released with the cache. A `readBlob` without a shared cache reloads it per call — likely most of the ~11 ms per blob read measured earlier. Heap returned to baseline after a forced GC in both variants.
- Stepping the timeline, once loaded: p50 239 ms / p90 278 ms per step over 154 steps, of which ~200 ms is the smooth-scroll animation; the pair's work is two blob reads plus Galley (~15 ms diff). No step lost an already-shown comparison.

### Proposed primitives (independent of the timeline UI)

1. **Pack-cached filesystem view under the Web Git port.** Hold the pack directory's files; answer loose-object probes from one listing of `objects/`; invalidate on any write under `.git/objects` (commit, fetch, deepen). ~50–80 lines; 37 s → ~2 s; every Web Git read benefits. Memory is what isomorphic-git already spends.
2. **History walker over an object reader** — pure: commit order, simplification rule, and every top-level book's blob id from the root tree in **one pass for all books**. No UI, no host.
3. **Book-change index** — a durable per-project file (beside the project, not inside `.git`; always rebuildable from Git): per commit the id, time, subject and parents, and per book change the blob id. **Measured for en_ulb** (scratch `src/dev/playground/bookIndex.ts`, in-memory pack view, Chrome): all 11,998 commits indexed in **4.0 s** (pack load 40 ms); 6,637 top-level book-change entries, kept per parent so merges carry one list per parent; **JSON 2.5 MB, 0.70 MB gzipped, ~0.78 MB as compact binary** (subjects 0.29 MB of that); JSON parse 4 ms; heap +52 MB while building (a worker's, not the page's). Genesis derived from the index in 2.9 ms equals native `git log -- 01-GEN.usfm` exactly (156 commits), so one index serves every book with git's default simplification; **every book's history** (68 paths, 6,006 entries) takes 116 ms, one in-memory graph walk per book — a single all-books pass would cost about one book's walk if that ever matters. A New Testament project is expected at tens to low hundreds of KB (not yet measured). Built at clone; extended at each fetch by walking only the new commits; rebuilt, or kept up to the merge base, when the stored tip is not an ancestor of the new one (force-push, rebase). Stale is detectable because it records the tip it was built from.
4. **Blob reader by id** for the displayed pair; Galley diff and the pure `deriveDeltaScope` projection unchanged.
5. **Per-commit, all-books view** falls out of (3): in en_ulb the median commit touches 1 `.usfm` file, p90 2, p99 15; 148 commits touch 10 or more (up to 1,322, from the pre-2017 per-chapter layout; the index counts only top-level books).
   5a. **Two points in time** needs no walk and no index: compare the two root trees' book entries. Measured 42 ms for "since 2023-01-05" (59 books, agrees with native `git diff --name-only`) and for "since the first commit" (66). "Since a date" is an index lookup for the commit, then the same comparison; then Galley per changed book. For a shared zip, the index alone carries blob ids but no texts: a zip that must render history ships the blobs for its range, or just the two endpoint texts for a "changes since" print. Wide or formatting-only commits collapse to per-book counts and open on demand, virtualized — never render a whole-Bible multibuffer.
   6a. **Common ancestor** — the split point between two tips (local and a fetched remote branch, or any two commits), as an in-memory walk over the index's parent links; milliseconds. Requires the index to cover the fetched remote branch as well as local history; both are keyed by immutable commit id, so that is a walk from a second tip, not a second index.
   6b. **Changed-on-both-sides facts** — ancestor→ours and ancestor→theirs as two root-tree comparisons (≈42 ms each) give books changed here, there, or both; for books changed on both, Galley `diff` from the ancestor to each side, intersected by unit address, gives "this passage changed on both sides" as a plain fact. Pure core, no Git or UI: it takes three texts or three skeletons. Galley's `merge` door applies decisions afterwards. What needs review, what may be taken without asking, and that scripture text is never merged automatically ([sync](../../documentation/architecture/sync.md)) stay policy over these facts, as the shared contract already separates "changed on both sides" from "requires review".
   6c. **Author name in the index** — today it holds time and subject only. Add the commit author's name if the UI shows commit metadata; still labelled as version history, never proof of who typed the wording.
6. **Own pack reader, only if earned** — for ranged reads holding only the 1.5 MB `.idx` (the `.pack` read at offsets, synchronously in a worker), or to cut the remaining ~2 s. `.idx` v2 lookup, object headers, inflate, OFS/REF deltas with a small base cache, commit/tree parse: an estimated 300–500 lines, testable byte-for-byte against native git. A WASM build belongs beside Galley in Scripture Kitchen so desktop's webview and the Web run one implementation. libgit2 has an Emscripten build (wasm-git) with its own filesystem and sync-XHR networking, which does not fit the `FileSystem` port; gix's lower-level crates may compile for `wasm32` (unverified). Transport and writes stay with isomorphic-git on the Web and git2 on desktop.

### Prototype on the spike branch (2026-09-26)

Primitives 1, 3, 5a, 6a, 6b and 6c are built as a drivable prototype on the `history-spike` branch of the spike worktree (`54f176b`; the scratch note there has the table and links). What it changed about the numbers above:

- **The pack view needs one more thing than planned: remember the `stat` of `.git`.** isomorphic-git stats `.git` on every command to learn whether it is a directory or a gitfile; in a worker build that was 47,959 OPFS calls and 30 s of a 31 s build. With it remembered, the whole en_ulb index build makes 10 filesystem calls and takes **4.9 s in a worker**.
- **Extend is cheap:** 49 new commits in 391 ms (100 ms of walking, 11,949 commits reused). A stored index (2.76 MB) opens in ~35 ms; a book's history from it in 19 ms (Genesis, 156 changes).
- **Merge facts cost ~0.5 s** on first view of a merge (common ancestor 1 ms, both sides' book lists 259 ms, passages changed on both 267 ms) — fine lazily, worth an index of per-side book lists if a list of merges ever needs them all at once.
- Not built: shallow-then-deepen in the worker, the exclusive lock on the app's writers, remote branches in the index, a two-points picker.

### Acquisition and background work

- **Shallow first, deepen in a worker.** An earlier browser run: depth-10 clone in 1.3 s / 1.5 MB against ~9 s for the full clone. Open and edit after the shallow clone; a dedicated worker (same origin, same OPFS; only workers get `createSyncAccessHandle`) deepens history and builds or extends the index, the timeline saying that older history is still arriving. The walker already reports a shallow boundary.
- **One writer for `.git`.** isomorphic-git has no locking, and a sync access handle locks its file exclusively. Use the Web Locks API (`navigator.locks.request`, shared across the page and workers, exclusive/shared modes, `AbortSignal`), wrapped as an interruptible Effect acquire/release. Deepen in chunks, taking the lock per chunk, so Record a version waits at most one chunk; chunks are also the cancellation points (isomorphic-git's `fetch` has no abort that we know of). Desktop: a per-repository mutex on the Rust side. This is the repository lifecycle (absent / busy / unhealthy / closing) that `services.md` lists as missing. A deepen writes a new pack, so it invalidates (1).
- **Server-side native git already exists for WACS**, but it does not replace the local index. It is Gitea 1.23.8: `GET /api/v1/repos/WycliffeAssociates/en_ulb/commits?path=01-GEN.usfm` returned the 156 commits (`X-Total: 156`) in 0.44 s. Building the all-books index over the API is worse than locally: pages are capped at 50 commits (240 pages for en_ulb, ~0.5 s each with `files=true`, ~2 min sequential), 130 KB per page with no compression offered (~32 MB), and the file lists carry names and status but no blob ids. `since` appeared to be ignored with `path`; `compare` returned commits but no files. The raw-file endpoints (`/api/v1/.../raw/...`, `/raw/commit/...`) are behind a Cloudflare bot challenge (403 "Just a moment…"); `git/blobs/{sha}` works (Genesis: 0.53 s, 273 KB base64 JSON) and `git/trees/{sha}` returned a root tree with blob ids in 0.18 s. So the API is at most a cold-open bridge — the first page of one book's history before local history exists — with network, paging, rate limits, Gitea-only and private-repository auth as costs; offline must not depend on it. A Rust Cloudflare Worker would be WASM, not native git, so it is not a shortcut.

### Link state

The spike's URL follows the slide in view: `?project=&book=&at=<12-char commit>&remote=<origin, credentials stripped>`. Opening a link walks back to `at` (~1 s for a recent change, ~40 s for the oldest without an index — the index makes it a lookup). A link for a project this browser lacks names it and its remote. Sharing between two arbitrary points (`from`/`at`) is not built; the UI compares adjacent changes.

### Galley cost per card

The prototype parsed each text three times per card (`analyze` twice for header chapter counts, then `diff`). Counts now come from the diff's per-side unit addresses, so a card is one engine call: Genesis p50 8.6 → 5.5 ms (first card ~16 ms while WASM warms). Feed whole books to `diff` — the plan's rule against chapter-sliced decision diffs stands — and use a chapter-hash pre-filter only for summaries (chapter filter, "changes since" across many books, per-commit chapter lists). Neighbouring cards still re-parse a shared text inside the engine; avoiding that needs an engine door that accepts a parsed text, not worth asking for at 5.5 ms.

## Appendix B: transcript

Transcribed with `chough` from `~/Downloads/diff.m4a`, unedited apart from line wrapping. Machine transcription: "cephyr" is Sefer, "Loklaw" is localized, "XXX3" is xxh3, "Ummatically" is presumably "automatically".

<details>
<summary>Full transcript (~2,300 words)</summary>

Um so one thing that I'm gonna need to fix compared to the old version that can feel flat. Uh is
not only do I have to fix the diff surface to be as non-developer friendly and yet leverage all the
advantages of text-based diff and collaboration through something like Git. Um I need a so there's
a bunch of miscellaneous things. One, the verbiage needs to be as non-developer friendly as
possible. Two the UI needs to be as non-developer friendly as possible. Three we want to use as
many primitives as possible. Four we want to um So the current I saw someone working the current
app and I was wondering if it was bug, I was wondering if it was slow or not so these bugs but
they're on a much older machine and I was like oh great e one I think theirs has a memory leak the
old cephyr because I saw memory climb to like 1.1 gigabytes which I'm just embarrassed of but it
happens. Two um I don't know if we're doing Git operations as efficiently as possible. Obviously
isomorphic Git gives us uh some limitations. So so here so here's the top to bottom of the
problems. Um one, conceptually we want the cheapest are we up to date? And I think that's just a
what's my latest shaw, what's that latest shaw for a remote. Alright, so that check should be
relatively cheap, I would think. If that is not the same, um I'm not sure if check out or clone is
actually what we should do or not. Because let's say somebody only changed um the book of Matthew
and I changed the book of Mark. That's two books that should dip. Not 66. So we shouldn't check out 66. So if there's a call in isomorphic Git, or we need to instrument it manually over like Git
APIs, the Git API, for J API, GitHub API, some API to traverse the blob directory specifically to a
file, then really you would only want to see the diff of those things. And then the next layer of
performance optimization is if that's not possible, then we have to just do a full checkout, like a
full clone to compare, that's one thing. I would love just file path and blob ID though. Which I
have a comment I'm gonna come back to there, so asterisk. The second thing is that so okay, you
change math, you got to mark we need to pull both those files we need diff both those files um even
then we have the ability to really cheaply take chexoms to feed into diff. We'll expose XXX3 in the
scripture kitchen, I think. And maybe it's not worth it and full file def should just be done. So
that context is available as a decision unit. I'm not sure. Or if we only want to feed in changed
chapters. So if you made changes only in chapter four, you know, should we really feed in the whole
file? I'm kinda tempted to think we should stick to full file diff because I think it's performant
enough to do it if we can only pull files. I feel like it's the network that's slow and it's um
it's network that's slow, like oh I've changed something in English UB. Now I have to pull all uh
five megabytes instead of only changed books. Or change blobs, we'll say, to be a little more get
get accurate. And then two, uh I don't know that it once the data is in process it full file death
is too slow. We should probably be measure just to see. My concern would be is if you try to do
chapter to chapter. Um I don't think we would be at risk. Uh because essentially you would want to
take the maximal set. So let's just say theoretically someone like a chapter. So those checksums
are gonna come off uh amiss. And the decision units are gonna be really weird because of that. But
I think So that's that's a maybe. Maybe, maybe not needed, I'm not sure, to only feed in a changed
chapter. We have to think about what that means if you add a chapter and delete a chapter. Um next
is what we'll call um so there's there's those two performance levels should matter a lot. And then
each decision unit so there should be a global granularity preference, which is probably per
decision unit we get a div, which is just like tiled the file as a mosaic. And once the file is
tiled, it does sell in those aligned units. And then inside of those aligned units, which for us is
what we call in Git terminol a hunk. So inside those aligned units or a decision unit, there's uh
the library in Scripture Kitchen, an onion takes an argument to be per word or characters. That's
probably should be a global preference in ours that defaults to per word. And then optionally down
to the per character unit. We should have done enough work to for any given tile or decision unit
you could flip to USFM or not, and you know if the change is only with respect to white spacing, um
or if it's only a USFM change. So. Next is um messaging. Um I need to think about oh, so this is
the other part that really needs some brain power of to do because I didn't fulfill this in the
previous product. And I really feel like I need to. Which is that the scripture burrito spec wants
MD5 hashes. If you're not gonna use a web-based web subtle crypto while they went with MD5, I don't
know, but MD5 hashes, um those are regenerable based upon the final accepted state. So those are
ephemerable tied to a commit point. So I'm not terribly worried about that. What I genuinely don't
know what to do about is we can say our app only cares about USFM, right? But that doesn't deny the
fact that one if we allow editing metadata in the manifest or in the metadata file for Burrito.
Ummatically generated, we don't have a way to resolve conflicts there. Now we don't allow that
today, but let's say this becomes a drafting tool and you want to delete a book or add a book or
something of that nature. I don't know what to do because I'm a little hesitant about creating a
You could say if that happens you have gone outside of our application and that's just that and
like we can't handle it if you've gone outside of our application. I'm also a little wary on Um a
little bit wary on building general purpose differs for like metadata files. I'm not sure. We could
say you throw uh information or an error that tech could handle and then because it's text, for
text like files you could say well this is an advanced debuggenario where somehow you've both
edited a text file that belongs to another repo. Here is the date on both. And someone who can just
understand a classic diff, just a regular text diff, has to pick one of the other. What that
doesn't handle is binary files, and I guess we could just say if it's not a known text extension
type, you just gotta go binary file. Um So I don't know if there's a way that we could just kinda
say, hey, this is not supposed to be Common Path. Our app only allows everything USFM. That's all
it ever presents you. If somehow you get a file changed on disk, then here's what we do. Um that's
one part that I want a little bit of advice on. And then the performance question. Um verbiage. I
said this about verbiage, but ideally because of our algorithms that we have, we know blob that
changed, and we need to potentially account for added blob, move blob, or rename blob, delete a
blob from the blobs directory. If we can do that instead of a full checkout. And then ideally I
would actually love to say maybe we check out the metadata file always. So always the manifest or
metadata.json. Reason being for using Loklaw's book names potentially um and then our messaging can
become committer made number changes in a list of books at time. Because that really clear, like
someone made these changes at this time. You last your last save made X changes and Xbooks and X
Time. Like that really user friendly information bubbling up and you're comparing two different
versions would help. Now obviously that's even doable for a zip in a folder, maybe not with the
committer information. But like we can basically classify every change within scripture as to a
book, to a chapter, down to a verse. So we can count changes in change points of how many are in
the same verse, how many are in the same chapter, and how many are in the same book. Right. And so
that kind of visibility is going to be we want the primitives to do that. So that when we pull or
check out blobs, between any two blobs which represent a USFM file, We want a layer or an effect
service or something in effect.pipe that pipes that comparison through with probably the type
should be call something like change metadata where given two changes um file and file for
scripture for us fm we classify and we may not end up showing all this but we classify uh things
and what that would allow potentially if it got asked for, we're talking about flexibility because
I don't know the full thing the product owner's gonna work or how people or teams might wanna work.
So we want to build for flexibility and the best development speed and the best development
products often lean into the constraints of your domain. And Scripture's greatest asset is the book
chapter versification. So then when you have that commit metadata as part of the pipeline, you can
do what the old editor did, but it should be really intentional that we do that. That we if someone
wants to say hey take all changes. Like it becomes policy. So our default cautious policy is eyes
on everything. But if someone needed it to dial it in or someone wanted to fork this and use it as
policy, it could become rebase changes from books that don't conflict. If you worked on Matthew and
I worked on Mark and that's how we knew we wanted to work and we didn't need eyes on that. We
didn't want to provide the friction of an additional review screen to say well you're not on the
same commit. Like that information should be there. And then I don't think anyone likely should
ever do it down to the first level, but theoretically we could, right? Cause um as a result of
diffing book and book, you could just say well here's only the conflicting verses like you could do
it even down to the method of conflict which conflict is your current version working or disc or
otherwise and the version coming in have changed the same part of table content, the same verse.
And that's conflict only. Um versus, you know, informational. Right? And so the informational ideas
like we're gonna surface everything to you. Uh and it's probably worth doing that. So informational
is I guess it's really two a two part enum right now and it's con conflict, which is I have
something different, you have something different for a scope. I e a book or chapter or verse.
That's conflict. And you could say conflict applies at any level. Conflict applies at book,
conflict applies at chapter, conflict applies at verse. And so we could say if you change the file
and I change the file, that's conflict at the book level. Um actually that's not true. We can say
conflict applies all the way at the project level. So for the project, if any file has changed at
all, um then eyes have to be put on it. Right, and that would be the most cautious espousal of this
view. And then a step down is to say if uh any but right but but but I guess what I'm trying to say
in terms of change metadata that I was talking about is conflict is not the same thing as um
information. And that's kind of a get thing and not just an informational thing, only in terms of
like Git would happily accept a fast forward. You change Mark, I change Matthew, no conflict. Um so
just because there's no conflict and you can fast forward, we have a different policy for handling
scripture. Um that needs to be piped piped through. So that metadata of what's changed, um we do
want to retain what I'm trying to say is there is some point in retaining the information of like
not only has it changed, but you've each changed it independently. Right, and so that's conflict in
the truest sense. And also unlike Git, we can define conflict in a way that doesn't. So Git would
say any two files changing at all is conflict, but we could technically through policy say only
overlapping chapter edits are conflict. Right. So our default it just needs to be bubble up nearly
anything and everything. Um performance Pulling only what needs to be pulled, diffing what only
needs to be diff. What do we do for everything that's not USFM? Like what's the same boundary for
our app without trying to just become a diff everything viewer. And Yeah.

</details>
