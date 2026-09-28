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
- **Open a menu twice** (2026-09-25). A change to `Popover` left every popover and menu refusing to open after its first close. Guard: the rail's Import menu opens, closes with `Esc`, and opens again.
- **Delete a whole verse in the editor** (2026-09-28). Deleting exactly `\v 9 …` up to `\v 10` in Matthew 3 also removed the `\v 10` marker, so verse 10's words ran on into verse 8. Not fixed yet: an editor rule widens the deletion. Guard: select from a verse's marker to the next verse's marker, delete, and the next verse keeps its marker and number.

### Unit test candidates

Pure core behaviour that a Node test over the in-memory `FileSystem` would pin, written down under the build-out rule (no new tests until behaviour is locked). The first one is data safety, which is where the rule costs most, so it goes first when the rule lifts or an exception is made.

- **Recovery keeps an earlier session's work** (2026-09-28, `src/core/recovery`). Three bugs, all fixed, none tested: the backup of the book a session lands on was hidden and then overwritten by the first keystroke; a journal id was spelled two ways, so Discard removed the file but not the in-memory journal, whose next flush wrote every entry back; and a restore replayed onto a book edited since it opened. Guard, with two `RecoveryLive` layers over one in-memory root standing in for two sessions: session 1 journals an edit; session 2's `pendingOnOpen` offers it and sets it aside (`@<time>`); session 2's own first edit leaves the set-aside file intact; `discard` of the set-aside id removes it and the next flush does not bring it back; `thisSession` is true for session 2's own journal and false for the earlier one; `restore` refuses when the book's stamp is not the first entry's `before`.

Colocate Node and focused browser tests with their owner; Web journeys live in `e2e/`.

## Tool references

- [Vitest Browser Mode](https://vitest.dev/guide/browser/)
- [Vitest environments](https://vitest.dev/guide/environment)
- [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)

Tool support changes. Verify current documentation when implementing or upgrading a harness.
