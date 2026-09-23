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

Colocate Node and focused browser tests with their owner; Web journeys live in `e2e/`.

## Tool references

- [Vitest Browser Mode](https://vitest.dev/guide/browser/)
- [Vitest environments](https://vitest.dev/guide/environment)
- [Tauri WebDriver](https://v2.tauri.app/develop/tests/webdriver/)

Tool support changes. Verify current documentation when implementing or upgrading a harness.
