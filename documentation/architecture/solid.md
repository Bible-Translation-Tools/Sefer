# Solid development and diagnostics

This is a SolidJS 2.x project. Solid is not React: components run once (there is no re-render), reactivity is fine-grained through signals, and effects/memos have Solid-specific semantics. Do not port React patterns.

## Versioned skills (in node_modules — read on demand)

The installed packages ship agent skills that match their exact installed versions:

- `node_modules/solid-js/skills/reactivity-diagnostics/SKILL.md` — repair guide mapping every dev-mode diagnostic code (e.g. `REACTIVE_WRITE_IN_OWNED_SCOPE`, `STRICT_READ_UNTRACKED`) to its prescribed fix. Read it whenever a Solid diagnostic code appears in test output or the browser console.
- `node_modules/@solidjs/diagnostics/skills/agent-loops/SKILL.md` — how to capture reactive evidence (which scopes re-ran and why, wasted recomputes, cost tables) and assert budgets, in tests and against live pages.

## Reactive diagnostics — capture evidence instead of guessing

Use these whenever you are debugging reactivity (something doesn't update, updates too often, or is slow) or verifying a change didn't regress update granularity:

- **In tests:** `captureArtifact()` from `@solidjs/diagnostics` wraps a scenario and returns a serializable artifact of diagnostics + rerun attribution; matchers from `@solidjs/diagnostics/vitest` (`toHaveNoDiagnostics`, `toStayWithinRerunBudget`, `toHaveNoWaste`, …) assert on it. No browser needed.
- **Against the running dev server** (`diagnostics: true` in vite.config.ts; dev-only, no-op in builds). Requires an open page connected to the dev server (e.g. via a browser tool):
  - `GET /__solid/diagnostics` — status and connected client count
  - `POST /__solid/diagnostics` with JSON `{"method":"begin"}` then `{"method":"end"}` — capture a session into an artifact
  - `{"method":"whyDidRun","params":{"name":"<scope name>"}}` — recorded re-runs of one named scope in the open session
  - `{"method":"costs"}` — running cost tables for the open session

Name your signals/memos/effects (the `{ name: "..." }` option) — attribution reports scopes by name.

## Measured: `HUGE_FAN_OUT` on a long list (2026-09-15)

`/start/find` drew the live catalogue — thousands of rows — and reported
`HUGE_FAN_OUT`. The findings below are measurements against a 1,333-row
catalogue on Solid `2.0.0-rc.6`, not readings of the code, and they are written
down because two of the three obvious repairs made it worse.

**What was ours, and is fixed.** Every row read the name-style signal
(`nameOf(entry)` inside the `<For>` body) and the busy-row signal. Both are
folded into one `createMemo` now, and a row receives plain values
(`src/app/ui/landing/FindProject.tsx`). No application signal is read per row
on that screen any more.

**What looked right and was not.**

- A per-key store `createProjection` keyed by row id — the repair the
  diagnostic's own message suggests — measured **worse**: 13,000 subscribers
  against 6,500. A store read still registers a node per row.
- A memo returning fresh row objects under an unkeyed `<For>` also measured
  worse, for a different reason: each flip tore down and rebuilt all 1,333
  rows. `<For keyed={(row) => row.id}>` fixes that, and the callback then takes
  an accessor — which is the per-key projection, done by the list itself.

**What is not ours.** At 1,333 rows the page still reports ~6,500 subscribers
on one unnamed signal, and the identical number appears when each row is five
instances of a five-line component that reads nothing at all. It is one
subscriber per COMPONENT INSTANCE; raw `<tr>`/`<td>` elements report zero.
Nothing in the screen or in `primitives/Table.tsx` moves it — the only lever is
rendering fewer components per row (or virtualising the list, which this table
will want anyway at six thousand rows).

Since then `FindProject` renders through `VirtualList`, keyed by `row.entry.id`,
so only the visible rows are components at all.

The lesson for the next long list: **name your signals**. The diagnostic prints
the name, and "signal" with no name was the whole of the evidence that the
remaining fan-out belonged to the framework rather than to us.
