# Cloud and Git follow-ups (2026-10-06)

What was left after the two ways to work and suggested changes shipped to `dev` (master `95dc8ab`).
The built behaviour is documented in [sync](../../documentation/architecture/sync.md) and
[git](../../documentation/architecture/git.md), "Suggested changes"; this note is only what is not
built. Each item says why it was left and what would settle it.

## Path (agreed 2026-10-07, from the preview demo)

Found showing copies and suggestions on `sefer-preview`. All five built on master on 2026-10-07,
unpushed; each item says what it became and what is left.

1. **Project switch kept the last project's save baselines.** Built (`9cc75d5`):
   `SaveCoordinator.forget()`, called from `closeProject`. Analysis and Galley already reset on
   attach; the seats map in `services.ts` is keyed by book and not cleared (harmless today).
2. **Reviewing a suggestion compared it with the editor.** Built differently from the plan
   (`2608b95`): the editor has to stay one side, because Review writes each decision into it as it
   is made, so instead the passages only the editor changed are left out of a suggestion review and
   counted in one line ("Show them"). An empty suggestion review says everything is already in the
   editor and that Save brings it in. The suggestion side's explainer is fixed, and "To review" shows
   titles and leaves out your own. Left: a reviewer who is BEHIND the shared project still sees, as
   the suggestion's, shared changes it carries — the common version is merge-base(HEAD, suggestion),
   not (shared tip, suggestion).
3. **Making a copy when the name is taken.** Built (`ab7aa05`): `Gitea.listForks` finds the copy
   whatever its name; a clash forks as `en_ulb-raphael`; a sibling is never attached. The WACS proxy
   allows GET on `forks` in its own commit `f460ac8`, NOT deployed — until it is, the Web looks each
   candidate name up by parent instead. Not walked against WACS.
4. **The double push.** Built (`ee20bf8`): offering pushes only when the copy lacks HEAD.
5. **Review layout prototype.** Built (`1a74c95`) on Review's own reader, after a plain-HTML first
   pass read as a different editor: sides named by who wrote them, the unchosen side dimmed
   (`Controls.dimUnchosen`, opt-in), one-sentence header — each against today's on a dial.
   Awaiting Will's ruling; nothing of it is on `/review` yet.

Not a bug: the "Default" commit (`d3d8722`) is a correct merge of Will's save with Larry's
`7bd978c5`. The local project was an older clone on June's `584fc57a`; the copy was forked on the
server from the current tip. The message was typed.

## Decided to defer

- **Decline as a recorded decision.** A plain Decline only closes the pull request on WACS. Its
  versions stay outside the shared project's history, so they ride along in the person's next offer
  and the reviewer declines the same passages again. The fix is to record a decline the way a
  partial accept already is: one decision commit with the suggestion as a parent and the editor's
  text everywhere ("keep ours"), sent, then the suggestion closed with the note. Costs: a decline
  becomes a sync action (needs the project open on a device that can write, adds one version to the
  shared project), and the "To review" list's Decline would have to fetch, record and send rather
  than call WACS. Deferred by Will to move on; revisit when declines start repeating in reviews.

  2026-10-07: only the plain-Decline case repeats (a full accept closes it; a partial accept
  already settles the kept passages). Hiding commits in the header does not fix it — the text still
  differs latest to latest. The recorded decline also resets the author's own copy to the shared
  text when they next receive; Will rejects that — someone working in their own copy takes the
  shared project's text deliberately, through Review, like anything else.

  Proposed (not yet ruled): **remember declines by content, with the closed pull request as the
  record.** A declined suggestion stays on WACS, closed and unmerged, and Gitea keeps
  `refs/pull/<n>/head`. When a new suggestion from the same person is reviewed, Sefer fetches the
  heads of their recent declined ones and marks any passage offering the same text as before as
  "Declined on 7 October", collapsed; a passage they edited since shows as new. No commit on
  either side, no new storage, the author's copy untouched. The author's side shows which passages
  were declined, so offering one again is a choice. If a per-passage reason is wanted later, it is a
  comment on the pull request or a [git note](git-notes-rationale.md).

- **What the author sees of a partial accept.** A suggestion brought in with some passages taken
  and others kept shows its author "Brought into the shared project" and the reviewer's message, not
  which verses were taken. Sefer could write the per-verse outcome ("Obadiah 1:1 taken; 1:2 kept")
  into the note, from Review's decisions at Save. Wants a ruling before the PO sees partial
  accepts.

## Beyond the first cut

- **See a suggestion as it was brought in.** Once closed, a suggestion can't be opened again in
  Sefer: no view of what was offered against what was taken, and no link from a version in History
  to the suggestion it came from.
- **More context on a suggestion.** Review shows who offered it, its title and its versions'
  messages. Not shown: the suggestion's discussion on WACS, or a description the author writes when
  offering (today the title is only the date, "Changes suggested on 6 October 2026").
- **The "To review" list shows the date, not the title.** A one-line change. Folded into path
  item 2.
- **Why-notes on single changes, in git** moved to its own idea:
  [git-notes-rationale](git-notes-rationale.md).

## Review layout (ideas only, for the playground)

From testing the suggestion review: the card shows two texts with marks on both, and what the project
will say is just "the lower one".

- **Sides labelled by who wrote them** ("will-kelly-test's suggestion", "Your project") — on the
  playground.
- **The result by brightness:** dim the side a decided passage will not read as — on the playground.
- **A one-sentence header** without the suggestion's version messages — on the playground.
- Tried and dropped (2026-10-07): "Will read" / "Instead of" cards and a segmented Keep, as plain
  HTML. Cleaner to read, but a different editor rather than an adaptation of this one, and it lost
  click-to-edit and the surrounding text. Review stays one USFM string, painted.

## Known loose ends

- **Seven load-time Solid warnings** (`STRICT_READ_UNTRACKED`, "read directly in an effect
  callback") on every project page's first load; none from navigating within the app. Source not
  found: the browser automation used could not register an init script to capture their stacks.
  First step: load a project page on a master from before 2026-10-06 and see whether they predate
  this work.
- **Desktop is untested** for the copy mode and suggestions. Desktop talks to Gitea directly (no
  proxy), so the allowlist problems found on the Web do not apply, but forking, reading the copy
  (`git_fetch_ref` with the `copy` remote) and the pull-request calls have not been run there.
- **`StateCopy.chip`** in `src/app/ui/cloud/copy.ts` is no longer drawn by any surface.
- **Account switching on one device**: a copy now counts only when the signed-in account owns it,
  but switching accounts in one browser was not walked end to end.
