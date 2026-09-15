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
out. The shell does the IO (`src/app/ui/cloud/reading.ts`, over core's `survey.ts`) and hands the
facts in. That is what
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
applied before the plan has been on screen. Combining takes two as well, for a stronger reason: it
rewrites the work tree, so the second press is a dialog naming the books that keep this device's
version.

## Diverged, and Combine

When both sides have work, Sefer offers exactly one move, and only when it is safe.

**Combine** is: take the shared project's versions as the base, then replay this device's work as
ONE version on top. It rewrites no shared history, produces no merge commit, and leaves a timeline a
person can read — "the shared project's three versions, then mine". `combinePlan` marks it `safe`
only when nothing is contested.

When a book IS contested, the primary action becomes Compare instead. Replaying over a file that
moved on both sides would either conflict or silently pick a winner, and both are worse than a
screen where a person looks at the two texts.

**Wired.** `src/core/sync/combine.ts` is the move, as an Effect program over the Git, Remote and
FileSystem ports and nothing else. Seven steps:

1. `remote.fetch` — the cloud's head as of this second, not as of the screen. A combine onto a stale
   head is the one way this move could lose somebody else's version.
2. `git.resolve(repo, refs/remotes/origin/<branch>)` — the base to sit on.
3. `git.show(HEAD, path)` for every path this device changed since the merge base, read while they
   are still reachable.
4. `remote.moveBranch(repo, branch, cloudHead)` — `writeRef` + a forced `checkout` on the Web,
   `git_move_branch` over git2 on desktop. The work tree becomes the cloud's.
5. write those bytes back over it.
6. `git.commit(repo, receipts, "Combine: <n> books on top of the cloud", author)` — ONE version.
7. `remote.push`.

The file is in two halves and the split is the point. `planCombine` is PURE — one survey of facts
in, one decision out — so every refusal is a unit test with no repository (`combine.test.ts`), and
the ladder's ORDER is policy the same way `syncStateOf`'s is:

| Refusal | What it means |
| --- | --- |
| `no-branch` | HEAD is detached or unborn; there is no branch to move. |
| `no-work-here` | No versions on this device to replay. |
| `no-cloud-copy` | The shared project has no copy of this branch. Publish first. |
| `no-shared-version` | No version in common, so no base to measure "what I changed" against. |
| `not-diverged` | Only one side moved: send or receive instead. |
| `contested` | Both sides changed the same file. Never merged; compared. |
| `unrecorded-work` | Files written but not recorded. The move is forced — they would be discarded. |
| `deletion` | `Git.commit` stages receipts, and a receipt cannot say "this file is gone". |
| `nothing-to-replay` | This device's versions changed no file. |

`contested` outranks every mechanical objection below it: when two people wrote the same book, that
is the thing to say, not that some third file happens to be unsaved. It is decided per FILE as well
as per book — `combinePlan` settles scripture, and a straight path intersection catches a manifest
or a versification file both sides touched, where "keep mine" would otherwise be a silent decision.

**The transaction.** Everything that can refuse happens before step 4, and every failure after it is
undone: the branch goes back to the version it was on and `moveBranch`'s forced checkout restores
the work tree. `CombineError.state` says which of three situations the repository is in — `untouched`
(a refusal, or anything up to and including the move), `restored` (put back; nothing reached the
cloud), or `stranded` (the move happened and the restore failed too). That last one is the only one
that needs a person, which is why it has a word rather than a stack trace.

**Two presses.** The first runs `previewCombine` — reads only, no network — and puts the books that
would keep this device's version into a confirmation dialog. The second runs `combine`, which
fetches and decides again, so a shared project that moved while the dialog was open is caught by the
program rather than trusted from the screen.

**Proved end to end.** `src/platform/web/combine.test.ts` runs the seven steps over real git
objects: two repositories in one in-memory file system, and a transport that copies loose objects
between them, because isomorphic-git speaks smart HTTP and nothing else — there is no local or
`file://` transport to point a second repository at. It asserts the three outcomes that matter: one
version on top of theirs with both books right, a contested book refused with the repository
untouched, and a failed send rolled back to the version and the work tree it started from.

**One survey, two callers.** `src/core/sync/survey.ts` reads the three revisions of every file the
cloud touched and hands them to `incomingPlan`. It lives in core because both the screen's reading
and the combine ask the same question, and if they computed "contested" separately the screen could
offer a move the program then refuses.

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

### The session, and why it survives a reload

Two facts about a Gitea session had to change together, because each made the other unrecoverable.

**The token name is granular to the second.** `login` mints `sefer-<platform>-<yyyymmddThhmmss>`.
It used to be granular to the day, and Gitea refuses a token whose NAME already exists with
`400 access token name has been used already` — so a second sign-in from one device on one day
could not sign in at all. The recovery is in `login` too: on that specific 400 it deletes the token
wearing our own name (the only moment the password is in hand, and Gitea's token endpoints refuse
token auth) and mints again under the same name; if the instance will not allow the delete, it mints
under `…-<suffix>` instead. `src/core/remote/gitea.test.ts` drives both branches against a mocked
instance — there is no real host in the test suite.

**The Web host persists the token.** `src/platform/web/credentials.ts` was a re-export of the
session-only store, on the reasoning that a browser has nowhere trustworthy to keep a secret. True,
and it made every reload a sign-out. It is now `localStorage`, with the trade written out in the
file: origin-scoped, readable by any script on the origin, therefore as safe as the page itself —
which is the bargain every browser application that stays signed in makes, and is survivable only
because the token is scoped (no `write:admin`), named after the device and the minute, and revocable
from Gitea's own settings page. Every call is wrapped: a private window or blocked site data falls
back to memory, which is exactly the old behaviour. Desktop still uses the OS keychain.

A token revoked on the server still reads as a session here until the next call fails
`Unauthorized`; the account card surfaces that, and a boot-time validation request is deliberately
not made.

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
know it exists. `diverged-apart` also carries a `CombineReplay`, so the confirmation dialog is
reachable with no repository the way every other card is; the real one comes from `previewCombine`.

Combine runs on the Web today. On desktop it stops at the same place `/cloud` does — the four `Git`
methods `src/platform/tauri/git.ts` refuses by name — so there is no cloud head to move onto until
those land.
