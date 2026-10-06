# Cloud and Git follow-ups (2026-10-06)

What was left after the two ways to work and suggested changes shipped to `dev` (master `95dc8ab`).
The built behaviour is documented in [sync](../../documentation/architecture/sync.md) and
[git](../../documentation/architecture/git.md), "Suggested changes"; this note is only what is not
built. Each item says why it was left and what would settle it.

## Decided to defer

- **Decline as a recorded decision.** A plain Decline only closes the pull request on WACS. Its
  versions stay outside the shared project's history, so they ride along in the person's next offer
  and the reviewer declines the same passages again. The fix is to record a decline the way a
  partial accept already is: one decision commit with the suggestion as a parent and the editor's
  text everywhere ("keep ours"), sent, then the suggestion closed with the note. Costs: a decline
  becomes a sync action (needs the project open on a device that can write, adds one version to the
  shared project), and the "To review" list's Decline would have to fetch, record and send rather
  than call WACS. Deferred by Will to move on; revisit when declines start repeating in reviews.

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
- **The "To review" list shows the date, not the title.** A one-line change.

## Review layout (ideas only, for the playground)

From testing the suggestion review: the card shows two texts with marks on both, and what the project
will say is just "the lower one".

- **Result first:** lead each card with the verse as it will be written, labelled "Will read", and
  the other side quieter underneath as "Instead of", with only the differing words marked.
- **State, not action, in the header:** a segmented **Keep: Yours · Suggested**, plus Edit, in
  place of the take/keep button pair.
- **Sides labelled by who wrote them** ("will-kelly-test's suggestion", "Your project") rather than
  by position, so left or right stops mattering.

Prototype on `/project/$slug/playground`, where diff UI work lives.

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
