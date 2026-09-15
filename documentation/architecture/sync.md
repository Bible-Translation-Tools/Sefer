# Cloud sync

How a translator learns where their work is, and what happens when they press the button.

This document is the sync SURFACE and the policy behind it. [git.md](git.md) is the layer below —
the `Git` and `Remote` ports, the Gitea account half, and the two hosts' implementations. Read that
one for how bytes move; read this one for what the screen says and why.

## The promise

Sefer is local-first. Nothing transfers as a side effect of editing, every transfer is a button
somebody pressed, and **scripture text is never merged automatically**. Those three are not
performance decisions; they are the product. A translator who cannot predict what a button will do
stops pressing it, and a tool that silently resolved two people's wording would be worse than one
that refused to sync at all.

Two consequences run through everything below:

- The screen always says what a press will do BEFORE it does it, with the real counts in the
  sentence. "Sends your 2 versions to the shared project. Nothing on this device changes."
- When both sides changed the same book, no automatic move is offered. That book goes to Compare,
  where a person decides.

## The vocabulary

`src/core` speaks git, because git is what it does. The surface does not. There is exactly one
translation point — `src/app/ui/cloud/copy.ts` — and past it nobody sees branch, commit, HEAD,
merge, rebase, fetch or origin.

| In core | On screen |
| --- | --- |
| the remote, `origin` | the shared project |
| a commit | a version |
| fetch | check for changes |
| pull | receive updates |
| push | send my changes |
| squash onto the remote head | combine |

The glossary is one module keyed by the state enum because v1's chip, banner, popover and settings
rows each grew their own wording for the same situations and drifted apart. Every string for a
state — the badge, the heading, the paragraph, the button, the sentence under it — comes from that
one table.

Every anxious state's paragraph ends by saying the work is still safe here. That is deliberate and
it costs one clause: a translator's first fear, always, is losing a morning's work.

## The state machine

`src/core/sync/state.ts` is pure. No Effect, no Git, no fetch: one `SyncReading` in, one `SyncState`
out. The shell does the IO (`src/app/ui/cloud/reading.ts`) and hands the facts in. That is what
makes every state reachable from a dev fixture with no Gitea instance, and it is why the whole
policy fits in one ladder.

| State | What it means | Primary action |
| --- | --- | --- |
| `detached` | No shared project is attached to this one. | Choose a shared project |
| `unpublished` | Attached, but the shared project has no copy of this branch yet. | Publish this project |
| `attached-clean` | Both sides hold the same versions. | Check for changes |
| `ahead` | This device has versions the shared project does not. | Send my changes |
| `behind` | The shared project has versions this device does not. | Receive updates |
| `diverged` | Both are true. | Combine, or Compare |
| `conflicted` | A transfer stopped part-way; the work tree is mid-merge. | Finish the transfer |
| `offline` | No network, or the last transfer failed on the way out. | Check for changes |
| `unauthorized` | No session for the shared project's host, or it was rejected. | Sign in |

`syncStateOf` is a ladder, and **the order is the policy**:

1. `conflicted` — a half-finished merge makes every other answer a lie, and it is the one state a
   person can settle with no network.
2. `offline` — while the device cannot reach anything, "you are three versions ahead" is true but
   not actionable. The clocks still say it.
3. `unauthorized` — reachable but not allowed in. Kept apart from offline because only one of the
   two is worth retrying unchanged.
4. `detached` — nothing to be ahead OF.
5. `unpublished` — attached to a repository the branch has never reached.
6. the clocks — diverged, ahead, behind, clean.

**Ahead and behind are a set difference over commit ids, not a merge-base walk.** Two histories with
no common ancestor therefore come out fully ahead AND fully behind, which is `diverged`. That is
v1's rule, learned the hard way: an optimistic answer there offers a fast-forward that silently
discards one side.

`primaryActionOf(state, contested)` picks the one right move. There is exactly one primary button on
the screen, never a row of Push / Pull / Fetch / Publish with three disabled — that row is a git UI
wearing a hat, and it asks the person to work out which verb applies, which is the job the state
machine just did. `contested` is the only input beyond the state, and it changes exactly one answer:
a diverged project whose two sides touched the same book goes to Compare instead of Combine.

## The two clocks

A translator does not think in refs. They think: how much of my morning has left this machine, and
how much of everyone else's has arrived. So a reading always yields both clocks, in every state
including the broken ones.

```ts
interface Clock {
  at: number | undefined;   // when this side last recorded any version
  unshared: number;         // versions it holds that the other side does not
  by: string | undefined;   // who recorded the newest one, when worth saying
}
```

- **This device** — `at` is the newest local version's time, `unshared` is how far ahead it is.
- **The shared project** — `at` is the newest cloud version's time, `unshared` is how far behind
  this device is.

`at` and `unshared` are separate numbers on purpose: a project can be perfectly in sync and still
have last moved a month ago, and that is worth saying.

`by` names the person only on the SHARED line, and only when there is something of theirs to
receive. The local line never does — we already know who that was — and an attribution left over
from a previous reading is worse than none at all.

Files written but not yet recorded as a version are counted separately and said so, because they
belong to neither clock.

## The incoming plan

Before a pull, `src/core/sync/plan.ts` works out what would actually change — from blobs the fetch
already brought down, so it costs no second transfer and can be shown before the question is asked.

```ts
interface IncomingBook {
  bookId: string;
  chapters: readonly number[];   // what the shared project changed; 0 is the front matter
  alsoHere: readonly number[];   // of those, what this device also changed
  contested: boolean;            // both sides touched this book
}
```

Chapters come from a textual split at `\c` markers rather than an engine parse: this runs over two
revisions of a file that may not be open, may not be a book Sefer instantiated, and may not even
parse. A wrong answer costs a slightly coarse sentence, never a wrong edit. The text before the
first `\c` is filed as chapter zero and called "the front matter".

"Also changed here" is measured against the WORK TREE, not against HEAD, so an edit saved to disk
but not yet recorded still counts as this device having touched the chapter.

**`contested` is per BOOK, not per chapter.** Two people editing different chapters of Mark still
produce one file whose two versions someone must reconcile, and pretending chapter granularity makes
that safe is how a verse goes missing.

The plan renders as sentences — "2 chapters of Mark changed in the shared project; 1 of them also
changed here" — with one row per book. A contested row shows a link to
`/compare?book=MRK`. The link is a PATH STRING, not an import: Compare is another screen with its
own lifetime, and this card must not depend on it having been built.

Receiving takes two presses. The plan card is the first; the confirmation is the second. Nothing is
applied before the plan has been on screen.

## Diverged, and Combine

When both sides have work, Sefer offers exactly one move, and only when it is safe.

**Combine** is: take the shared project's versions as the base, then replay this device's work as
ONE version on top. It rewrites no shared history, produces no merge commit, and leaves a timeline a
person can read — "the shared project's three versions, then mine". `combinePlan` marks it `safe`
only when nothing is contested.

When a book IS contested, the primary action becomes Compare instead. Replaying over a file that
moved on both sides would either conflict or silently pick a winner, and both are worse than a
screen where a person looks at the two texts.

**Half wired.** The branch move exists now: `Remote.moveBranch(repo, branch, toCommit)` is `writeRef`
+ a forced `checkout` on the Web and `git_move_branch` over git2 on desktop. What is still missing is
the replay around it — read this device's books out of HEAD, move onto the cloud's head, write them
back, record ONE version, push. That is policy and belongs beside `combinePlan` in `src/core/sync`,
not in a button handler, so the Combine button still says plainly that it is not wired rather than
running a merge nobody asked for.

**Finish the transfer is wired.** `Remote.abortMerge(repo)` — isomorphic-git's `abortMerge` on the
Web, `git_abort_merge` over git2 on desktop — puts the work tree back to HEAD and clears the merge
state, and the Resolve button runs it through the same `transfer` path as every other press. It
REFUSES when nothing is in progress, deliberately: it is a hard reset underneath, and on a clean
repository that would discard a translator's unsaved morning instead of undoing a transfer.

## Offline

Read twice, because neither detector is enough alone:

- `navigator.onLine`, kept live by the window's own events. Instant and free, but it only knows
  whether an interface is up — a captive portal, a dead proxy and a firewall all report `true`.
- A transfer that failed with `RemoteError.reason === "Network"`. Slow to learn, but it is the
  question actually being asked.

Either one makes the state `offline`, and coming back up clears a stale network verdict so the next
press is an ordinary attempt rather than a retry of something already given up on.

Offline is the least alarming state on the surface. The work is on disk, the clocks still show what
is waiting, the button says "Check for changes", and nothing suggests anything was lost.

## The screen

`/cloud` (`src/routes/cloud.tsx` → `src/app/ui/cloud/CloudScreen.tsx`), inside a `ShellGate`, four
cards in the order someone asks the questions:

1. **Account** — sign in and out. An ACCOUNT action, not a project one: the same session serves every
   project on the device. Failures render inline under the form, never as a toast, because the form
   is where the person is looking.
2. **Project** — the shared project it belongs to, the two clocks as two stat lines, the state as one
   badge, and the headline and paragraph from the glossary.
3. **What would arrive** — the incoming plan, shown only when something is coming.
4. **What happens next** — the one primary button, and one sentence under it saying what will move
   and what will not.

The screen holds no domain state. The session lives in `Credentials` (through `Gitea`), the
attachment lives in the repository's own `origin`, the state is derived fresh by the pure machine —
so a reload or a second window shows the same truth rather than a copy of it.

`createAccount` and `AccountCard` (`src/app/ui/cloud/account.ts`) are shared with the project page's
`CloudPanel`, which keeps the attach-and-publish half. The two surfaces cannot disagree about what
"signed in" means because there is one implementation of it.

## What the ports grew

Additive, and named for jobs rather than for library calls:

- `Git.logFrom(repo, ref)` — the cloud's side of the comparison, off the remote-tracking ref.
- `Git.resolve(repo, ref)` — `Option`, because "the shared project has nothing yet" is an answer,
  not a failure.
- `Git.branch(repo)` — which branch HEAD is on, so the tracking ref can be named.
- `Git.changedPathsBetween(repo, from, to)` — what makes the incoming plan possible without a second
  transfer.
- `Remote.origin(repo)` — the read half of `attach`.

Web answers all five over isomorphic-git. Desktop answers `origin` through the `git_remote_url`
command it already has and **refuses the other four by name**, with a `TODO(seam)` in
`src/platform/tauri/git.ts` listing the four git2 commands `src-tauri/src/git.rs` would need
(`Revwalk::push_ref`, `revparse_single`, `Repository::head`, `diff_tree_to_tree`). Refusing by name
is the honest stub: better than reporting a project up to date with a remote it never compared
against. Until those land, `/cloud` on desktop reads `detached` and says so.

## Seeing every state

`?syncState=<name>` on `/cloud`, in a dev build, renders a fixture's facts instead of the
repository's — through the same pure derivation and the same cards, with no branch in the rendering
that asks where the data came from. A row of buttons above the cards switches between them and
writes the choice into the URL.

The names are the nine states plus `diverged-apart`: the same STATE as `diverged` and a different
screen, because when the two sides touched different books the primary action is Combine and when
they touched the same one it is Compare. A list with only `diverged` would never show the first.

The fixture lives in `src/app/ui/cloud/fixture.ts`, is reached only inside an `import.meta.env.DEV`
branch, and changes nothing about the application's composition — `src/app/services.ts` does not
know it exists.
