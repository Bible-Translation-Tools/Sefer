# Testing strategy

Status: agreed direction; adopt incrementally as capabilities arrive. This document defines ownership, not a claim that every suite exists today. For exploratory checks, read [agent verification](../agents/verification.md). The test-double policy is [test doubles](test-doubles.md).

## Commands

The manifest and Vite/Vitest configuration define these commands:

- `pnpm test`: starts Vitest with its normal interactive/watch behavior.
- `pnpm test:unit`: runs the Node `core` project — every `src/**/*.test.ts` except `*.browser.test.*`, and `tools/**/*.test.ts`.
- `pnpm test:browser`: runs Chromium Browser Mode tests through the Playwright provider, headless. `headless: true` is stated in `vite.config.ts` rather than left to the default, which is headless in CI and HEADED on a laptop — which would raise a window over whatever the person at the machine was doing, and on macOS take the keyboard with it.
- `pnpm test:e2e`: builds the app, serves `dist/client` through `vite preview`, and drives it with Playwright (`e2e/`). Three smoke assertions and deliberately nothing about how a screen looks.
- `pnpm check`: runs typecheck, lint, format check, `pnpm boundaries`, Node tests, and the Web build. Lefthook's `pre-commit` runs all of it except the build (plus `pnpm lint:results`).

CI: `.github/workflows/check.yml` runs `pnpm check` on every branch except master, with `pnpm test:browser` in a second job. Master's gate is `release.yml`'s `verify` job — `pnpm check`, `pnpm deadcode` and `pnpm test:browser` — and preview and production add `pnpm test:e2e` and `pnpm verify:design`.

Vitest separates a Node core project from a Chromium Browser Mode project using Vitest's Playwright provider. Both projects set `extends: true` so they inherit the root plugins; without it the Solid JSX transform never reaches browser tests. There is no jsdom project and no shared-isolation override. Check isolation requirements when introducing stateful tests.

Browser Mode holds four files: the OPFS `fileSystemContract` suite, web git, the fixture page, and the composition's dev observability surface. A Playwright smoke suite exists (`e2e/`); a desktop WebDriver harness does not.

## Choose the seam that owns the risk

Protect application behavior and data guarantees. Prefer the smallest test that can fail for the relevant reason. A new feature does not need one test at every level, and a utility does not need tests that merely restate its implementation.

Use real production code and controlled real resources by default. Prefer temporary directories, real CodeMirror state, the pinned Galley artifact, real browser behavior, and production adapters. Deterministic implementations of explicit production ports are acceptable when another seam owns the platform mechanism; constrain them with shared contract suites. Avoid module mocks, scripted collaborators, fake editor/engine behavior, and call-count assertions.

### Vitest in Node

Own application rules that do not require rendering: transaction acceptance, stale actions, save/recovery transitions, resource roles, and meaningful utility edge cases. Use small in-memory implementations of actual application ports where appropriate. Complete operations can be tested here without reducing every test to one function.

Keep parser and proofreader semantic suites in their owning repositories. Retain a few real engine integration contracts here for loading, input/output wiring, and correct source/range publication. Mocked output cannot establish that the pinned engine integrates correctly.

### Vitest Browser Mode

Own focused browser-sensitive editor and component behavior. Mount a small fixture to exercise selection, protected-range deletion/paste, undo, view modes, satellite synchronization, focus, and lifecycle behavior.

Use the Playwright provider. Browser Mode is a focused test harness inside a real browser; it is not a duplicate whole-application journey suite. Start without jsdom or happy-dom. Add another environment only to address a measured need.

**The operational rule, learned the hard way on 2026-09-22.** Browser Mode is for **real browser APIs at module level**; Playwright is for **the built artifact**. A test that renders the application shell to check that it looks right belongs in neither — behaviour is still moving, and that is how a suite becomes something people learn to skip.

Three of the five files here were red at once, and the split is what explains which. The two that had never broken — the OPFS `fileSystemContract` suite and web git — assert a CONTRACT against a real browser API with no UI in sight. They cannot be written in Node, and they cannot be written in Playwright without building a harness page to re-expose the modules. They are also structurally rot-proof: what they assert does not move when a screen moves, which is the property to aim for in every test written from here on.

The three that broke were app-shell tests, the lane where Browser Mode was quietly acting as a slower, weaker Playwright. One of them — "the application mounts" — was a strict subset of a Playwright smoke test that makes the same claim against the real bundle rather than the dev module graph, so it was deleted rather than repaired. Between two tests of one claim, the weaker one goes.

The other two were kept because they assert something real that nothing else can reach: that the composition publishes its dev observability surface, and that the fixture page seeds through the one composition rather than a second. Both had merely gone looking for `boot` in `logs` after it became an operation read through `traces`.

Browser Mode is fast because it is small. Keeping it small is the maintenance.

### Direction: journeys, desktop, cadence

What follows is the agreed direction, not a description of suites that exist.

- **Playwright journeys** own complete Web flows through the built application — open/edit/save/reload, diagnostic navigation and fixes, recovery — asserting visible outcomes and durable side effects, with one real vertical slice through each production Web persistence adapter. Today `e2e/` holds only the three smoke checks.
- **Desktop journeys** own Tauri integration: real IPC and permissions, filesystem bytes, restart/recovery, host lifecycle, editing in the system webview. The intended route is WebdriverIO with `@wdio/tauri-service`; there is no desktop suite yet. Web and desktop save journeys overlap deliberately, because their host boundaries differ; editor permutations stay at their lower seam.
- **Empirical checks** — real IME composition, RTL selection, platform interaction — need hands-on verification on supported systems; synthetic events do not close the real-IME gate. Performance sweeps stay separate from correctness checks.
- **Cadence.** Node tests are the default feedback (aim below ten seconds); focused Browser Mode cases for editor work; the full fast suite plus a small Web smoke before merge; desktop smoke for changes to shared save contracts, permissions, packaging and dependencies. If a budget fails, look for unnecessary setup, duplication or misplaced coverage before moving a necessary check to a rarer cadence.

### Journey candidates

Flows a real user broke that a Playwright journey would have caught. Written down rather than built, because the screens are still moving (the designer may change them) and a suite that breaks on every redesign is one people delete. Each says what it guards, so a journey written later asserts the behaviour and not the pixels.

- **Import a zip, then reload on the project** (2026-09-25). A zip whose entries start with `/` imported one folder down, said "Ready", and the project then opened as "no project here". Guard: after importing, the project opens, and a reload on its URL opens it again.
- **Go to a chapter, then run a chapter command** (2026-09-25). A chapter tile scrolled the book but left the caret where it was, so "Match formatting from source: this chapter" refused ("put the cursor in a chapter first") or matched the chapter the caret was still in. Guard: after the sidebar's chapter N tile, a chapter-scoped command acts on chapter N.
- **Type at a paragraph's end** (2026-09-25). End on "…he meditates day and night." (Psalm 1:2, before a blank line, `\s5` and `\q`) left the caret one past the visible end, inside the hidden run, where every key and Insert footnote was refused. Guard: at the end of a paragraph before `\s5`, before `\q` and before `\p`, End and a click past the end put the caret after the last visible character, a typed letter lands there, and Insert footnote puts the note there.
- **Delete at a passthrough join** (2026-09-25). Where a paragraph flows through a blank line and `\s5` (Philemon 1:9–10), Backspace after the space and Delete before it each removed one invisible newline, the join re-formed, and the key looked stuck. Guard: at such a join, one Backspace or one Delete joins the words (no space left on screen), the source keeps no orphan line or bare `\s5`, and one Undo restores the gap.
- **Type into a fresh footnote** (2026-09-25). A settlement change briefly put the note editor's caret before `\ft `, and "hello" went in as "olleh". Guard: Insert footnote, type a word, and the note's body reads the word.
- **Undo a word typed in an excerpt** (2026-09-25). Every character typed in a Find excerpt was its own undo step. Guard: type a word in an excerpt, one Undo removes it.
- **Open a menu twice** (2026-09-25). A change to `Popover` left every popover and menu refusing to open after its first close. Guard: the app bar's Import menu opens, closes with `Esc`, and opens again.
- **Delete a whole verse in the editor** (2026-09-28). Deleting exactly `\v 9 …` up to `\v 10` in Matthew 3 also removed the `\v 10` marker, so verse 10's words ran on into verse 8. Not fixed yet: an editor rule widens the deletion. Guard: select from a verse's marker to the next verse's marker, delete, and the next verse keeps its marker and number.

### Unit test candidates

Pure core behaviour that a Node test over the in-memory `FileSystem` would pin, written down under the build-out rule (no new tests until behaviour is locked). The first one is data safety, which is where the rule costs most, so it goes first when the rule lifts or an exception is made.

- **Recovery keeps an earlier session's work** (2026-09-28, `src/core/recovery`). Bugs fixed, none tested: the landing book's backup was hidden and then overwritten by the first keystroke; a journal id was spelled two ways, so Discard did not stick; a restore could replay onto an edited book; a journal kept across a save was refused forever; books edited only through cards were never journalled, and a revisited book was journalled twice. Guard, with a `RecoveryLive` over the in-memory `FileSystem`, a real `openProject` and a hasher, two layers over one root standing in for two sessions: session 1's edits journal with `base` = the file's hash, under the book's PATH; an edit to an unseated book journals once, and seating it does not add a second subscriber; editing back to the file clears the journal at the next flush; `compact` after a save trims, rehashes `base`, removes this project's `@` journals and leaves another project's alone; session 2's `pendingOnOpen` offers a `base` match, drops an `end` match, marks a neither as `stale`; its first flush moves session 1's file aside rather than overwriting it; `restore` refuses a book whose hash is not `base` and keeps a set-aside journal whose replay was not journalled.
- **Where a windowed list puts the reader** (2026-09-29, `src/app/ui/primitives/virtualScroll.ts`). Pure over numbers and keys, and every rule in it is there because a case broke on the fixture, so a regression shows as the same screen misbehaving again. Guard: `rebuild` is `top` when no row on screen survives (a new query), `hold` on the pinned row when it survives and else on the first surviving row on screen, `stay` when nothing was drawn; `heldOffset` moves the scroll by exactly the anchor's own move and not at all when either start is unknown; `compensates` is always true above a pinned row (a first measurement too — the 201px push of an edited card), false for any other first measurement (the 8,154px walk down `/findings`), and for a re-measurement true only wholly above the fold; `aimStep` scrolls while the target is more than a pixel away, settles after three still frames, and gives up after sixty or when the target is gone.
- **What a reader does to a card** (2026-09-29, `src/app/ui/multibuffer/cardState.ts`). Pure transitions over one card's view. Guard: `stepExtent` — fold of a widened card is the unit alone and remembers the reach, fold again restores exactly it, fold of an unwidened card is no change, chapter toggles, up and down add one and forget a fold; `reduce` — a step from an unwidened view starts from the screen's `from`, and `usfm`, `pairedFlip` and `open` toggle only their own field; `sameExtent` compares folds deeply.

- **What a clipped view draws at its edges** (2026-09-30, `src/editor/recipes/satellite.ts`, `src/editor/core/decorations.ts`). A card clipped to start at a chapter's `\c` drew the PREVIOUS chapter's notes above it (Mark 14 showed Mark 13:33's footnote): a chapter's notes are anchored after its last line, one character before the next `\c`, and the chapter-overlap test is inclusive at its end. Fixed by telling the build the surface's clip (`BuildOpts.clip`) and drawing a notes block only when its anchor is inside it. Guard, headless over the fixture or en_ulb Mark 13–14: a reader or satellite clipped to chapter 14 has no `.usfm-notes` before its `\c 14` line; clipped to a verse, none at all; and the clip moving (a reclip) re-decides. Open, found while fixing it: the clipped chapter's OWN notes do not show at its end either, and should.
- **A card's policy is its matrix** (2026-09-30, `src/editor/views.ts`, `src/app/ui/multibuffer/policy.ts`, `src/editor/core/deletion.ts`). Guard: `editorPolicy("regular", "lock-verse-numbers")` resolves `slot.v` to a point×immortal pip with no `typable`; `"hide-notes"` freezes caller, markup and body to none×immortal and elided; USFM plus a preset layers in order; `policyKey` is equal for equal policies. And the deletions under it: Backspace or Delete beside a locked pip moves the caret and leaves the number; a range that covers a locked pip, or a `\c`, whole writes around it (Mark 14:36: selecting across "36 He" and deleting leaves `\v 36 ` and takes "He "); a range covering a passthrough (`\s5`) whole still takes it, with no `\s5lways`.
- **A widened card is re-clipped, not remounted** (2026-09-30, `src/app/ui/excerpts/ExcerptReader.tsx`). Widening hands the card a new excerpt over the same parse, and the mount effect's compute read `props.analysis` through it, returned a fresh object, and destroyed and rebuilt the CodeMirror view — the card collapsed for a frame and the list below jumped. Guard (browser): Show more or a context step keeps the same `.cm-editor` element and only its lines change.

- **Emptying a verse number is two deliberate steps** (2026-09-30, `src/editor/core/deletion.ts`, `owned.ts`, `recipes/lint.ts`). On Genesis 15:18–19 (`…Euphrates—` then `\v 19 the Kenites`), unlocked, in Regular. Guard: Backspace at `19 |the` gives `\v 1 the`; again gives `\v  the` with the caret at the empty number's place (before the space, not after it) and the empty-number finding shown ("Either type a verse number here…", no `delimiter-surplus` beside it); a typed `7` gives `\v 7 the`; Backspace at the empty box takes the marker AND its space (`Euphrates—\nthe`), not the line break before it; the finding's Fix does the same. The same for an empty `\c`, which is immortal: Backspace there only moves the caret.

- **A card's keys are the editor's keys** (2026-09-30, `src/editor/recipes/satellite.ts`, `core/compose.ts` `deletionKeys`, `core/deletion.ts`). A satellite's Backspace was CodeMirror's plain delete, so none of the keypress rules reached a card and the Book refused ("nothing survives the write-around") at a locked pip. Guard, in a card with locked verse numbers widened one unit up: at `\v 3 |While` (Mark 14:3, the verse opening its paragraph) one Backspace goes past the locked `\v 3` in USFM terms and takes the paragraph by its anchoring newline (`…the people."\n\n\s5\n\v 3 While`), never the `"` before it; at `\v 7 |You` mid-paragraph it takes the join before the pip (`…for me.\v 7 You`) — only a paragraph-level marker owns the newline before it (editor.md, "What a key does"); at the first verse of a card whose TOC unit starts at `\v`, Backspace only moves the caret; and the satellite's verdicts reach the Book's Observability ring.

### Git lifecycle and sync candidates

Carried over from the Git lifecycle spec (2026-09-29, built; the spec itself is retired — `git log -- planning/01-discussing/diff-and-sync-model-2026-09-23.md`). None is built: the build-out rule holds until behaviour is locked.

Each test sits at the smallest seam that owns its risk:

- **Vitest `core` project:** plain TypeScript in Node. Core is written over ports, so the test provides the host part: the in-memory `FileSystem` layer (the one the dev fixture seeds), or a real production adapter where the claim needs one (isomorphic-git over Node's filesystem for the native-git comparison). No mocks of core itself.
- **Browser Mode:** a real browser API (OPFS, Web Locks, isomorphic-git) at module level.
- **Playwright:** the built artifact.
- **cargo:** git2.

None of them asserts how a screen looks.

#### Playwright journeys (`e2e/`)

**Harness:**

- **The remote** is a local git smart-HTTP server started by the Playwright config: `git http-backend` behind a small Node HTTP wrapper that adds CORS, with native git on the runner. Bare repositories are seeded per test from `fixtures/small-nt/`, with `receive.denyNonFastForwards` set, so any force push fails the journey. The built app reaches it through the endpoint preference ([configuration](configuration.md)), so no build flag changes.
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

#### Vitest `core` project (Node, host injected)

1. **Adoption allowlist:** over the in-memory `FileSystem`, a `.git` with remotes, remote refs, `packed-refs` remote lines, hooks, a credential helper and a token URL. Guard: only objects, heads, HEAD and shallow survive, the config is fresh, and each fallback reason (gitfile, merge in progress, unresolvable HEAD) is chosen.
2. **The history index against native git:** the core walker over the batched reader, on a fixture repository with merges, a TREESAME merge, a rename and repeated blobs. Guard: each book's history equals native `git log -- <path>` from a `tools/` probe; forward growth, backward growth and the rebuild on a force push each give the same index as building from scratch.
3. **The decision commit:** over the in-memory `FileSystem` and isomorphic-git, a diverged pair. Guard: the commit's parents are both tips, its tree is exactly the final files (per file: theirs-only → theirs, mine-only → mine, both → the decided text), and nothing uncommitted in the work tree is ever discarded, including when the commit fails.
4. **Change facts and policy:** three texts per book in, per-book verdicts out, at each overlap scope. Guard: `book` (the default) sends any book changed on both sides to review; `chapter` passes different chapters of one book; unchanged, added and deleted are all reported; nothing is decided twice (Combine and the state machine read the same answer).
5. **The lifecycle machine:** every state × event. Guard: mutations are refused outside `ready`, `unhealthy` is left only through its tools, and `closing` refuses new work.
6. **Checksums:** md5 over the written bytes, not LF text; an unchanged book leaves `metadata.json` byte-identical.

#### Browser Mode

1. **One writer across contexts:** the Web Locks lane from the page and a worker, and from two pages. Guard: exclusive holders never overlap, a save waits at most one deepen chunk (`lock.wait_ms`), and releasing an exclusive lock invalidates the pack view.
2. **The batched reader over OPFS** on a repository with a backslash tree entry. Guard: no `UnsafeFilepathError`, and the same answers as the Node run of test 2.

#### cargo (`src-tauri`)

1. **A push the server refuses is `Rejected`** (the push-update-reference callback), against a bare repository that has moved on.
2. **The batched reader in git2** returns the same batches as the Web reader for the shared fixture.
3. **The per-repository mutex** serialises two mutating commands.

#### Suggested changes, exercised by hand on 2026-10-06

Journeys a second, non-writer account walked on the Web ([git](git.md), Suggested changes); each found a bug that is now fixed, and none is guarded:

- **A refused send offers the copy, and the copy is found, not forked twice.** Guard: after a 403 push, "Work in my own copy" attaches the existing fork (no second fork request), and the mode is chosen only once the copy is attached.
- **A send to the copy is not "waiting to be sent".** Guard: after a send in the copy mode, the reading counts nothing unsent (it is measured against `copyRef`), and the copy's ref equals HEAD — the lane wrapper once dropped `fetchRef`'s remote and read the shared project instead.
- **A partial accept brings in what was taken and closes the suggestion.** Guard: take one passage, keep another, Save; the shared project's newest commit carries the taken text and keeps the other, the suggestion is closed with the reviewer's message and the `BROUGHT_IN` line, and Save was enabled (a take written into the editor once read as "kept none").
- **Keeping none of it is declining it.** Guard: with passages offered and none taken, Save is closed; Decline closes the suggestion (checked in Gitea's answer — a PATCH sent without its body is a 200 that changes nothing) and only then posts the note.
- **The author reads the outcome.** Guard: Suggestions → Yours shows a brought-in suggestion as taken and a declined one as closed with the editor's note, by the `BROUGHT_IN` line and not by git (every suggestion reports its copy branch's current tip as its head).

Colocate Node and focused browser tests with their owner; Web journeys live in `e2e/`.

## Tool references

- [Vitest Browser Mode](https://vitest.dev/guide/browser/)
- [Vitest environments](https://vitest.dev/guide/environment)
- [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)

Tool support changes. Verify current documentation when implementing or upgrading a harness.
