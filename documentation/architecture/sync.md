# Cloud sync

How a translator learns where their work is, and what happens when they press the button.

This document is the sync SURFACE and the policy behind it. [git.md](git.md) is the layer below —
the `Git` and `Remote` ports, the Gitea account half, and the two hosts' implementations. Read that
one for how bytes move; read this one for what the screen says and why.

## The promise

Sefer is local-first. Nothing transfers as a side effect of editing, every transfer is one the
person asked for — a button, or a per-project setting they can see and turn off — and **scripture
text is never merged automatically**. Those three are not
performance decisions; they are the product. A translator who cannot predict what a button will do
stops pressing it, and a tool that silently resolved two people's wording would be worse than one
that refused to sync at all.

Two consequences run through everything below:

- The screen always says what a press will do BEFORE it does it, specifically. "Sends your saved
  changes to the shared project. Nothing on this device changes."
- **Counts are verses and books, never versions.** "3 verses in 2 books differ from yours"
  (`incomingWords`, from the incoming plan's own numbers); what has not been sent is said, not
  counted ("Saved changes not sent yet", `outgoingWords`). However many versions it took either
  side, a review compares the newest against yours once, and "3 versions you don't have" read like
  three reviews to do.
- When both sides changed the same book, no automatic move is offered. That book goes to Compare —
  the Review screen, `/project/$slug/review` — where a person decides.

## The vocabulary

`src/core` speaks git, because git is what it does. The surface does not. There is exactly one
translation point — `src/app/ui/cloud/copy.ts` — and past it nobody sees branch, commit, HEAD,
merge, rebase, fetch or origin.

| In core              | On screen          |
| -------------------- | ------------------ |
| the remote, `origin` | the shared project |
| a commit             | a version          |
| fetch                | check for changes  |
| pull                 | receive updates    |
| push                 | send my changes    |
| a decision commit    | combine            |
| a fork of the remote | your own copy      |
| a pull request       | suggested changes  |

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

| State            | What it means                                                    | Primary action          |
| ---------------- | ---------------------------------------------------------------- | ----------------------- |
| `detached`       | No shared project is attached to this one.                       | Choose a shared project |
| `unpublished`    | Attached, but the shared project has no copy of this branch yet. | Publish this project    |
| `attached-clean` | Both sides hold the same versions.                               | Check for changes       |
| `ahead`          | This device has versions the shared project does not.            | Send my changes         |
| `behind`         | The shared project has versions this device does not.            | Receive updates         |
| `diverged`       | Both are true.                                                   | Combine, or Compare     |
| `conflicted`     | The work tree is mid-merge — left by a tool other than Sefer.    | Finish the transfer     |
| `checking`       | Asking the shared project what changed, right now.               | (waits)                 |
| `offline`        | No network, or the last transfer failed on the way out.          | Check for changes       |
| `unauthorized`   | No session for the shared project's host, or it was rejected.    | Sign in                 |

The public door is `sync(reading, contested)` (`src/core/sync/state.ts`), which answers the state, the two clocks and the one primary action as one value. Inside it, the private `syncStateOf` is a ladder, and **the order is the policy**:

1. `conflicted` — a half-finished merge makes every other answer a lie, and it is the one state a
   person can settle with no network.
2. `checking` — the answer is being asked for right now, and every clock below may be about to
   change. The check holds the repository's lane, so a send or a combine waits for it.
3. `offline` — while the device cannot reach anything, "you are three versions ahead" is true but
   not actionable. The clocks still say it.
4. `unauthorized` — reachable but not allowed in. Kept apart from offline because only one of the
   two is worth retrying unchanged.
5. `detached` — nothing to be ahead OF.
6. `unpublished` — attached to a repository the branch has never reached.
7. the clocks — diverged, ahead, behind, clean.

`conflicted` can only come from another tool now: Sefer never starts a merge — a receive only
fast-forwards and Combine writes a decision commit — so the state exists for a repository someone
opened in a terminal.

The reading also carries `sendRefused`: the last send — a press, or the one after a save — did not go
through. It does not change the state (the failure's reason already does) but it changes the words:
the work was saved, and only the sending did not happen.

**Ahead and behind are a set difference over commit ids, not a merge-base walk.** Two histories with
no common ancestor therefore come out fully ahead AND fully behind, which is `diverged`. That is
v1's rule, learned the hard way: an optimistic answer there offers a fast-forward that silently
discards one side.

The private `primaryActionOf(state, contested)` picks the one right move. There is exactly one primary button on
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
  at: number | undefined; // when this side last recorded any version
  unshared: number; // versions it holds that the other side does not
  by: string | undefined; // who recorded the newest one, when worth saying
}
```

- **This device** — `at` is the newest local version's time, `unshared` is how far ahead it is.
- **The shared project** — `at` is the newest cloud version's time, `unshared` is how far behind
  this device is.

`at` and `unshared` are separate numbers on purpose: a project can be perfectly in sync and still
have last moved a month ago, and that is worth saying. `unshared` decides WHETHER a line has
something to say; it is never shown as a number (see "Counts are verses and books" above) — the
shared line says the plan's verses and books, the local line that saved changes are not sent yet.
The time is the coloured word on both.

`by` names the person only on the SHARED line, and only when there is something of theirs to
receive. The local line never does — we already know who that was — and an attribution left over
from a previous reading is worse than none at all.

Files written but not yet recorded as a version are counted separately and said so, because they
belong to neither clock.

## The incoming plan

Before a receive, `src/core/sync/plan.ts` works out what would actually change — from blobs the fetch
already brought down, so it costs no second transfer and can be shown before the question is asked.

```ts
interface IncomingBook {
  bookId: string;
  path: string;
  kind: ChangeKind; // added, modified or deleted
  chapters: readonly number[]; // what the shared project changed; 0 is the front matter
  alsoHere: readonly number[]; // of those, what this device also changed
  contested: boolean; // both sides touched this book
}
```

The plan is a VIEW over two things decided elsewhere. `src/core/sync/facts.ts` measures what each
side did to a book since the merge base — changed or not, which chapters, which verses — from the
engine's whole-book diff, projected by `history/delta.ts`, so a bridge, a moved verse and an added
chapter are addressed the way Review addresses them; nothing slices a book at `\c`. The text before
the first `\c` is filed as `FRONT_MATTER` (chapter zero) and called "the front matter". A side whose
texts differ but cannot be located is still changed, with no places. Every text is normalised to LF
first, which the engine requires, so a file whose only change is its line endings names no chapter.
`survey.ts` reads the three revisions of every file the cloud touched (from blobs the fetch already
brought down) and calls `galley.diff` directly rather than Review's small cache.

Facts decide nothing. `src/core/sync/policy.ts` is the ONE place overlap is decided:
`judge(facts, overlap)` gives each book a verdict — `none`, `keep` (only mine changed), `take` (only
theirs), `combine` (both, not overlapping at the scope), `review` (both and overlapping, or one side
unlocated). The state machine's `contested`, the plan, receive, Combine and "Skip review of incoming
changes" all read that answer, so the screen can never offer a move the program then refuses. The
dev fixture (`src/app/ui/cloud/fixture.ts`) writes its plans out literally, because a module-level
constant has no engine to ask.

"Also changed here" is measured against the Books' CURRENT text — unsaved edits included — not
against HEAD, so an edit not yet recorded still counts as this device having touched the chapter.

**The default overlap is the BOOK** (`DEFAULT_OVERLAP`). Two people editing different chapters of
Mark still produce one file whose two versions someone must reconcile, and pretending chapter
granularity makes that safe is how a verse goes missing. `chapter` and `verse` exist so a team can
choose otherwise, and `project` for the most cautious; none of them is offered on a screen yet.

The plan renders as sentences — "2 chapters of Mark changed in the shared project; 1 of them also
changed here" — with one row per book. A contested row links to the Review
screen, `/project/$slug/review`. The link is a PATH STRING (`reviewHref` in
`src/app/ui/cloud/IncomingPlanCard.tsx`), not an import: Review is another screen with its own
lifetime, and this card must not depend on it.

Receiving takes two presses. The plan card is the first; the confirmation is the second. Nothing is
applied before the plan has been on screen — unless the person turned on "Skip review of incoming
changes", and then only when the policy lets every book through. Combining takes two as well: the
second press is a dialog naming the books that keep this device's version and the ones that arrive.

## Receiving

`src/core/sync/receive.ts`. A receive is a fast-forward, and it moves the Books with the files:

1. fetch, so the other side's tip is this second's — BEFORE the repository's exclusive lane is
   taken, so a slow network holds the lane only for its own transfer, never a Record a version
   behind it; the rest runs in the lane;
2. refuse unless HEAD is the merge base — this device having commits the other side lacks is a
   divergence, and Combine's;
3. classify every book the other side changed against each Book's current text, and ask the policy;
4. refuse whole if any book needs a person, or if a file the other side changed has changes here no
   version holds;
5. hand each changed Book the other side's text (`handOver`, `src/core/sync/classify.ts`), as one
   `incoming` edit per Book, all or none, in ONE synchronous step: each Book is looked up afresh
   (opening a book swaps its object) and its stamp checked against the classification in the same
   turn as the apply, so no keystroke can land between "this book may be replaced" and the
   replacing. A Book that moved is read again once, then the receive refuses with nothing written;
6. `Remote.fastForward`: the branch moves and the work tree follows through a SAFE checkout; if it
   cannot, every Book is given its text back;
7. every changed Book's baseline follows its file (`SaveCoordinator.takeDisk(book, "incoming",
"keep")`), each one attempted and a failure listed rather than leaving the rest behind.

Step 5 is what `pull` never did. It moved the files and left every open Book, and its baseline, on
the old text, so the next save wrote the old text back over what had just arrived. Handing the Books
their text BEFORE the files move is what makes a refusal cheap: nothing on disk has changed yet.
This is the one exception to "only Save writes a book" ([INVARIANTS](../INVARIANTS.md)): the bytes
are Git's, and the Book learns them in the same move. `/cloud` says what a receive could not finish:
a book file that arrived or went (the book set is fixed while a project is open), or a book whose
file could not be read back.

| Refusal             | What it means                                                     |
| ------------------- | ----------------------------------------------------------------- |
| `no-branch`         | HEAD is detached; there is no branch to move forward.             |
| `no-cloud-copy`     | The shared project has no copy of this branch.                    |
| `no-shared-version` | The two histories have no commit in common.                       |
| `diverged`          | This device has commits the other side lacks: Combine.            |
| `review`            | A book both sides changed, by the policy's measure: Compare.      |
| `unrecorded`        | A file the other side changed has changes here no version holds.  |
| `moved`             | A book was typed into or opened while the receive read it, twice. |

`receive` takes `settled` — the books whose project text a person has just decided in Review
(below) — and `theirs` when the other side is not the shared project's tip: a suggestion's head.

## Diverged, and Combine

When both sides have work, Sefer offers exactly one move, and only when it is safe.

**Combine** (`src/core/sync/combine.ts`) records ONE DECISION COMMIT with two parents — this device's
tip and the shared project's — whose files are the final text. Nothing is replayed, nothing is
rebased, git's merge never runs, neither side's history is rewritten, and sending the result is a
fast-forward on every remote that holds either tip, so there is never a forced push. Per file:

- changed only on this device — this device's, as HEAD already holds it;
- changed only on the other side — theirs, written into the work tree and handed to the Book;
- changed on both — never here. The policy sends that book to a person, and the whole combine
  refuses before anything is written, unless Review has already settled it (below).

It replaced a squash: move the branch onto the cloud's head with a forced checkout, write this
device's files back, record them as one version, and push. That rewrote this device's history, could
discard a file the checkout overwrote, and read on the other side as one anonymous blob.

The file is in two halves and the split is the point. The private `planCombine` is PURE — one survey
of facts in, one decision out — so every refusal can be decided with no repository, and the ladder's
ORDER is policy the same way `syncStateOf`'s is:

| Refusal             | What it means                                                         |
| ------------------- | --------------------------------------------------------------------- |
| `no-branch`         | HEAD is detached or unborn; there is no branch to join onto.          |
| `no-work-here`      | This repository has no commits.                                       |
| `no-cloud-copy`     | The shared project has no copy of this branch. Publish first.         |
| `no-shared-version` | No commit in common, so no base to measure "what I changed" against.  |
| `not-diverged`      | Only one side moved: send or receive instead.                         |
| `contested`         | Both sides changed the same file. Never merged; compared.             |
| `deletion`          | The other side deleted a file, and a receipt cannot say "it is gone". |
| `moved`             | A book was typed into or opened while the combine read it.            |

`contested` is decided per FILE as well as per book: the policy settles scripture, and a straight
path intersection catches a manifest or a versification file both sides touched, where "keep mine"
would otherwise be a silent decision. `metadata.json` is the exception: its checksums describe the
files, so it is never a decision. The combine takes the other side's, then works the checksums out
again over the combined files (`ProjectAdmin.refreshChecksums`) and records it in the decision
commit, beside what each decided book's save kept current. Without that, every Scripture Burrito
project refused to combine, because every save on each side changes the file. Unrecorded work is no longer a refusal, because nothing is
checked out over it: the files that arrive are only ones this device did not change.

**The transaction.** Everything that can refuse happens before the first write, including the
Books taking the other side's text, all or none, the same way a receive does. The files are then
written and recorded; if recording fails they are put back and the Books are given their text back
(a Book typed into since keeps the typing). A commit that fails leaves the index as it found it, on
both hosts, so nothing staged for it rides into the next commit. Once recorded, the baselines follow
the files, and the result is sent to `destination()`. Like a receive, the fetch runs before the
exclusive lane is taken. `CombineError.state`
says where the repository is:

- `untouched` — nothing was written: every refusal, and every failure up to the first write;
- `restored` — the files were written, the commit failed, and they were put back;
- `recorded` — the combination is on this device and sending it failed; the next send carries it;
- `stranded` — the commit failed and putting the files back failed too. The only state that needs a
  person, which is why it has a word rather than a stack trace.

**Reached through Review.** Combine runs from Review's Record (`settleWithShared`, below), never
from a button of its own: `combine` fetches and decides again, so a shared project that moved while
the review was open is caught by the program rather than trusted from the screen. (Until 2026-10-06
`/cloud` had its own two-press Combine, a `previewCombine` dialog and then the combine; the popover
already sent every incoming state to Review, so it went with the card that held it.)

**One survey, two callers.** `survey.ts` lives in core because the screen's reading and the combine
ask the same question, and if they computed "contested" separately the screen could offer a move the
program then refuses.

### A contested book, settled in Review

When a book is contested the primary action is Compare: Review, with "the shared project" as the
other side (`/project/$slug/review?against=shared`), where every passage says whether it changed
there, here, or in both places ([review](review.md)).

What is recorded is **the project's text**, the latest of it: the person's choices, and anything
they typed into the review's cards. Every passage has a side even before anyone chooses — what only
the shared project changed is preset to theirs, what only this device changed to mine — and a
passage changed in both places has no preset: Record waits until every one of those has a choice.
Pressing Record makes the presets real (the passages still set to theirs are taken into the
project's text), and then every book the review showed is SETTLED: its project text is the
decision, whatever the policy would have said about it. `settleWithShared`
(`src/app/syncActions.ts`) then either receives with `settled` and records a version, when this
device had no commits of its own, or combines with `settled`, which writes the decision commit
over the settled text. Books the review did not show — the two sides already agree — simply
arrive.

The first build settled from the verdicts instead, and lost decisions both ways: a book only the
other side changed was overwritten with theirs even where the person had kept a passage of their
own, and a book both sides changed was kept whole, dropping every one of the other side's passages
nobody had ruled on.

**Finish the transfer is wired.** `Remote.abortMerge(repo)` — isomorphic-git's `abortMerge` on the
Web, `git_abort_merge` over git2 on desktop — puts the work tree back to HEAD and clears the merge
state. It REFUSES when nothing is in progress, deliberately: it is a hard reset underneath, and on a
clean repository that would discard a translator's unsaved morning instead of undoing a transfer.

## Checking on open, and sending on save

`src/app/syncActions.ts` holds the two settings that reach the network.

`checkForChanges` runs when a project opens, and again after a send the server refused. It asks the
cheapest question first — `Remote.probe`, the server's refs in one round trip — and fetches only when
the server's tip is not the one this device already holds; against the sandbox that is about 450 ms
when nothing changed. It never moves a file. With "Skip review of incoming changes" on, a receive
follows, and the receive refuses whenever a book needs a person, so nothing arrives unreviewed that
the policy would have shown. It runs as the `sync.check` operation.

`sendAfterSave` runs after Record a version, and only sends: the server's fast-forward rule is the
check, and a refusal starts `checkForChanges` at once so every surface reads `behind` or `diverged`
with the facts rather than a bare error. It returns how the send ended (`SendOutcome`: sent, held
because the project does not send on save, attached to nothing, or refused for a reason), and the
Record dialog stays open on it: one line for this device, one for the shared project, and the move
the second offers — Compare the changes for a refusal because the shared project moved, Try sending
again when it could not be reached, Open Sync for a sign-in. `sendNow` is the same send without the
setting, for a button someone pressed.

### Two ways to work

Ruled 2026-10-06: exactly two modes, per project on this device (`CollabMode` in
`src/app/syncSettings.ts`), and never a remote chosen per press.

1. **Together in the shared project.** Send to and receive from `origin`. The default when the
   account can write to what it cloned.
2. **In my own copy, offering changes when ready.** Send to `copy` (a Gitea fork); "Offer my changes"
   opens a suggestion ([git](git.md), Suggested changes). The default once a send is refused for
   permission; the first mode is then not offered until the shared project's permissions change.

Whether an account can write is the network's answer, asked again on the check's schedule
(`collaboration.ts`); a refused send outranks any remembered one. A gained permission is said in the
popover ("You can now work directly in the shared project") and never acted on by itself; a writer
going back just sends. A writer may choose the copy mode (a paper trail of suggestions). Choosing it
makes the fork, or finds the one made on another device; a project cloned from the person's own fork
is re-rooted (its parent becomes `origin`); a shared project that is the person's own and copies
nothing asks which project it should suggest to, and refuses one that shares no history with it. A
suggestion brought in by Review is always sent to the shared project, whatever the reviewer's own
mode. In the copy mode the check also reads the person's copy into `refs/sefer/copy`
(`fetchCopy`); when it holds work this device lacks — sent from another of their devices — the
popover offers "See the changes", Review against it (`?against=shared&copy=1`, labelled "Your
copy"), and Record catches this device up and sends back to the copy. Nothing from the copy arrives
without that review. Still to come: a Suggestions tab beside Review and History.

### One reading for every surface

`src/app/syncWatch.ts` holds the open project's last reading (`readSync` and its plan) for the whole
application, the way `syncStatus` holds the network. The check on open, every send, a combine or
receive from Review, and `/cloud` itself leave their reading there; the app bar's cloud button
(`SyncButton`), Review's status line (`SyncLine`) and `/cloud` read it. A reading is local work — refs
and logs already in the object database — so opening the cloud popover reads again; only a check or
a send touches the network.

The cloud button is quiet when both sides agree, tinted when work is waiting to be sent, and tinted
with a "!" when something waits on a person (versions to receive or review, a refused send, a
sign-in, a stopped transfer). A project attached to nothing is never the alarm. Its popover is where
sync is done: the state, the two clocks, the incoming changes, the one right move, the shared
project's link to copy, and the account — signing in and out (`SignInForm`, the same fields and
failure line as Settings' account card). Anything that receives goes through Review ("See the
changes"); "Finish the transfer" (`conflicted`) runs `Remote.abortMerge` from the popover; attach and
publish are still `/cloud`'s.

Neither runs with no network interface up, and both go through the ports' lanes, so a check and a
send cannot race. A network failure the last transfer met does NOT stop them
(`syncStatus.interfaceUp`, not `online`): they are how Sefer finds out it is over, and a signal that
waited for a success before trying would never see one.

### The settings

Four per project, stored on this device keyed by project root and never in the repository — whether
this laptop checks on open is not a fact about the translation (`src/app/syncSettings.ts`, shown on
Settings' Cloud section by `SyncSettingsCard`, while a project is open):

| Setting                         | Default | What it does                                        |
| ------------------------------- | ------- | --------------------------------------------------- |
| Check for changes on open       | on      | `checkForChanges` when the project opens.           |
| Send my changes on save         | on      | `sendAfterSave` after a version is recorded.        |
| Skip review of my changes       | off     | Record a version without opening Review first.      |
| Skip review of incoming changes | off     | Receive after a check, when no book needs a person. |

The two that reach the network are on, so an ordinary translator never learns the words fetch and
push. The same file keeps this device's author name.

### Who a version is by

`src/app/author.ts`: the signed-in account's username; else the name this device was given, asked
once the first time a version is recorded; and "Sefer" only for Sefer's own bookkeeping (an import's
arrival). The email is empty rather than invented.

## Offline

`src/app/syncStatus.ts` holds it for the whole application — online, the last failure, which roots
are checking, whether the last send was refused — so `/cloud`, the check on open, send on save and
the Save dialog cannot disagree. Online is read twice, because neither detector is enough alone:

- `navigator.onLine`, kept live by the window's own events. Instant and free, but it only knows
  whether an interface is up — a captive portal, a dead proxy and a firewall all report `true`.
- A transfer that failed with `RemoteError.reason === "Network"`. Slow to learn, but it is the
  question actually being asked.

Either one makes the state `offline`, and coming back up clears a stale network verdict so the next
press is an ordinary attempt rather than a retry of something already given up on.

Offline is the least alarming state on the surface. The work is on disk, the clocks still show what
is waiting, the button says "Check for changes", and nothing suggests anything was lost.

## The screen

`/project/$slug/cloud` (`src/routes/_app/project/$slug/cloud.tsx` → `src/app/ui/cloud/CloudScreen.tsx`), inside a `ShellGate`.
Since 2026-10-06 it is what is left once sync moved into the app bar's popover and its configuration
into Settings' Cloud section (`CloudPanel`: account, shared project, the four switches). Its account
card, its "What happens next" card with the one primary button, and its settings card are gone. What
remains:

1. **Project** — the shared project it belongs to, the two clocks as two stat lines (the time is the
   coloured word), and the headline and paragraph from the glossary. No chip: the headline takes the
   state's colour when it wants something from you.
2. **Incoming changes** — the incoming plan, shown only when something is coming, in verses: "There
   are changes to 3 verses in 2 books. You also changed 1 of those verses." Then one plain line per
   book; only a verse you both changed is coloured. Verses are the engine's units from the same
   facts the policy reads (`IncomingBook.verses`, `versesAlsoHere`); a change it could not place
   falls back to chapters.
3. **Suggested changes** — only when they apply: your own copy and "Suggest my changes", "Make my
   own copy" for an account that cannot write, or the waiting suggestions for one that can
   ([git](git.md), Suggested changes).
4. **Shared project** — when the next step is attach or publish (the popover's "Open Sync" lands
   here for those two).

The screen holds no domain state. The session lives in `Credentials` (through `Gitea`), the
attachment lives in the repository's own `origin`, the state is derived fresh by the pure machine —
so a reload or a second window shows the same truth rather than a copy of it.

### The session, and why it survives a reload

Two facts about a Gitea session had to change together, because each made the other unrecoverable.

**The token name is granular to the second.** `login` mints `sefer-<platform>-<yyyymmddThhmmss>`.
Gitea refuses a token whose NAME already exists with
`400 access token name has been used already`, so a name granular only to the day would stop a
second sign-in from one device on one day. The recovery is in `login` too: on that specific 400 it deletes the token
wearing our own name (the only moment the password is in hand, and Gitea's token endpoints refuse
token auth) and mints again under the same name; if the instance will not allow the delete, it mints
under `…-<suffix>` instead.

**The Web host persists the token.** A session-only store would make every reload a sign-out, so
`src/platform/web/credentials.ts` uses `localStorage`, keyed by host, with the trade written out in
the file: origin-scoped, readable by any script on the origin, therefore as safe as the page itself —
which is the bargain every browser application that stays signed in makes, and is survivable only
because the token is scoped (no `write:admin`), named after the device and the minute, and revocable
from Gitea's own settings page. Every call is wrapped: a private window or blocked site data falls
back to memory. Desktop still uses the OS keychain.

A token revoked on the server still reads as a session here until the next call fails
`Unauthorized`; the account card surfaces that, and a boot-time validation request is deliberately
not made.

`createAccount` (`src/app/ui/cloud/account.ts`) is the one implementation of "signed in": the popover
and `CloudPanel` on `/settings` each make one, and `SignInForm` and `AccountCard`
(`src/app/ui/cloud/AccountCard.tsx`) draw it. The attach-and-publish half, `SharedProjectCard`
(`src/app/ui/cloud/SharedProjectCard.tsx`), is on `/settings` and on `/cloud` whenever the next step is
attach or publish. An attach or publish re-reads the sync state.

## What the ports grew

Named for jobs rather than for library calls: `Git.logFrom`, `Git.resolve` (`Option`, because "the
shared project has nothing yet" is an answer), `Git.branch`, `Git.changedPathsBetween`,
`Git.mergeBase`, `Git.commit`'s `alsoParents`, `Remote.origin`, `Remote.probe`,
`Remote.fastForward`, `Remote.push(repo, to?)`, and for suggested changes `attachAs`, `urlOf` and
`fetchRef`. `Remote.pull` and `Remote.moveBranch` are gone. Both hosts answer every one; the desktop
command table is in [desktop host](desktop.md).

## Seeing every state

`?syncState=<name>` on the cloud screen, under the dev server only (`import.meta.env.DEV` — unlike `?fixture=1`, which any `__SEFER_DESIGN__` build honours), renders a fixture's facts instead of the
repository's — through the same pure derivation and the same cards, with no branch in the rendering
that asks where the data came from. A row of buttons above the cards switches between them and
writes the choice into the URL.

The names are the ten states plus `diverged-apart`: the same STATE as `diverged` and a different
screen, because when the two sides touched different books the primary action is Combine and when
they touched the same one it is Compare. A list with only `diverged` would never show the first.

The fixture lives in `src/app/ui/cloud/fixture.ts`, is reached only inside an `import.meta.env.DEV`
branch, and changes nothing about the application's composition — `src/app/services.ts` does not
know it exists.
