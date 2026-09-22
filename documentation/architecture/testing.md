# Testing strategy

Status: agreed direction; adopt incrementally as capabilities arrive. This document defines ownership, not a claim that every suite exists today. For exploratory checks, read [agent verification](../agents/verification.md). The provisional test-double policy is [nearly no mocks](../../planning/00-ideas/nearly-no-mocks-testing.md).

## Current scaffold commands

The current manifest and Vite/Vitest configuration define these commands:

- `pnpm test`: starts Vitest with its normal interactive/watch behavior.
- `pnpm test:unit`: runs the Node `core` project — every `src/**/*.test.ts` except `*.browser.test.*`, and `tools/**/*.test.ts`.
- `pnpm test:browser`: runs Chromium Browser Mode tests through the Playwright provider, headless. `headless: true` is stated in `vite.config.ts` rather than left to the default, which is headless in CI and HEADED on a laptop — so the suite used to raise a window over whatever the person at the machine was doing, and on macOS take the keyboard with it.
- `pnpm test:e2e`: builds the app, serves `dist/client` through `vite preview`, and drives it with Playwright (`e2e/`). Three smoke assertions and deliberately nothing about how a screen looks.
- `pnpm check`: runs typecheck, lint, format check, `pnpm boundaries`, Node tests, and the Web build. Lefthook runs the same commands on `pre-commit`, and `.github/workflows/check.yml` runs them in CI with `pnpm test:browser` in a second job.

The scaffold separates a Node core project from a Chromium Browser Mode project using Vitest's Playwright provider. Both projects set `extends: true` so they inherit the root plugins; without it the Solid JSX transform never reaches browser tests. There is no jsdom project and no shared-isolation override. Check isolation requirements when introducing stateful tests.

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

### Playwright journeys

Own complete Web flows through the actual application: open/edit/save/reload, diagnostic navigation and fixes, one-match replacement, and recovery. Assert visible outcomes and relevant durable side effects.

Keep permutations at their owning lower seam. Retain a small real vertical slice through each production Web persistence adapter; an in-memory replacement proves orchestration but not actual persistence.

### WebdriverIO desktop journeys

Own Tauri integration: actual IPC and permissions, filesystem bytes, restart/recovery, host lifecycle, and representative editing in the system webview. Begin with one open/edit/save/restart/file-inspection slice. Use real commands for integration proof rather than mocking the boundary being tested.

The intended starting route is `@wdio/tauri-service` with its embedded driver. Confine automation plugins to verification builds. Prove platform capabilities before documenting native-dialog or IME automation as supported.

Web and desktop save journeys deliberately overlap because their host boundaries differ. Do not copy every editor permutation into both suites. Share fixtures and expected outcomes before introducing cross-runner abstractions.

### Empirical checks

Real IME composition, RTL selection, and platform interaction need hands-on verification on supported systems. Synthetic events are useful but do not close the real-IME gate. Keep performance/corpus sweeps separate from routine correctness checks, with reproducible inputs, build mode, host, and dependency revisions.

## Cadence and speed

These are intended command meanings and initial warm-run budgets, not existing script names or measured performance:

- Default feedback: Node application tests, aiming below 10 seconds.
- Editor work: selected Browser Mode cases, aiming for a few seconds per selected case.
- Merge checks: full fast suite, relevant browser coverage, and small Web smoke; aim initially for roughly one minute excluding cold builds.
- Desktop integration changes: require desktop smoke, including changes to shared save contracts, permissions, packaging, and dependencies. Also run a small desktop smoke regularly in CI to catch shared frontend drift.
- Release checks: supported browser/OS matrix, broader desktop coverage, real IME checks, and performance measurements.

Measure compilation, setup, and execution separately. If a budget fails, identify unnecessary setup, duplication, or misplaced coverage before moving necessary checks to a less frequent cadence. Select application crates explicitly when sibling crates share a workspace; do not rerun their full corpus suites on every app edit.

## Organization and adoption

For new application work, colocate Node and focused browser tests with their owner. Put full journeys under `tests/e2e/web/` and `tests/e2e/desktop/`, with a small shared fixture collection. These are intended locations: do not reorganize existing tests merely to match them.

Establish one meaningful application test, one focused editing test, and one real save/reopen journey per host before expanding the infrastructure. Read current runner configuration before assuming the default command isolates Node tests.

## Tool references

- [Vitest Browser Mode](https://vitest.dev/guide/browser/)
- [Vitest environments](https://vitest.dev/guide/environment)
- [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)

Tool support changes. Verify current documentation when implementing or upgrading a harness.
