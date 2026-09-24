# Logging and tracing: evidence agents can read

**Status:** 2026-09-24. Discussion with leans, revised after a second review. The current design is in [observability](../../documentation/architecture/observability.md); this doc is only about what is unsettled.

## Goals (Will's)

1. **Insight into LLM-written code.** Tests can be written badly; runtime behaviour lies only where it is not instrumented.
2. **No SaaS-style telemetry.** Field users are on low bandwidth, so nothing phones home by default.
3. **Agents see how their code actually runs,** including its performance, through a known set of filters to use like `jq`.
4. **"Export debug log" in a build,** as JSONL (or OTel-shaped) with the facts support needs: build, tag, OS, WebView/browser, user agent, whether there is a remote, the commit, where in the sync lifecycle, whether diverged. No sensitive data, such as WACS usernames.
5. **Errors are immediately visible.** Levels are optional; tracing everything may be enough.
6. **Performance-minded.** Web is single-threaded: no console thrashing, no continuous flushing.
7. **Respectful of disk.** Anything written to disk expires.

**The guard:** don't overengineer. Each item below either serves one of these goals directly or waits.

## Where things stand

- **One ring, wide events.** Operations (`boot`, `project.open`, `save`, `find.run` and so on), spans inside them, and notes carrying a verdict (`passed`, `refused`, `failed`, …). The ring holds 2,000 events, and the level `off | verdicts | spans | all` defaults to `all` in every build.
- **Three renderers, all fed by the one assembler:** the dev rings behind `__sefer.observability`, the console stream (`VITE_SEFER_STREAM` or `stream()`), and the dev-only OTLP bridge.
- **One write API in practice:** `operation()` / `span()` / `note()`, with 19 operation sites and about 50 notes. Effect's `Logger` is routed into the ring, but app code does not use it.
- **Client failures** are `client.error` notes: boundary-caught, uncaught and unhandled rejections.
- **Holes, checked 2026-09-24:**
  - `console.error` in `src/editor/core/trace.ts` (`stateFailed`) and `console.warn` in `src/editor/recipes/lint.ts` ("fix discarded") bypass the ring.
  - Failures are recorded but not seen. `errors()` is a dev-only pull; nothing pushes a failure at you.
  - A burst of typing spans can push the one failure you care about out of the 2,000-event ring.
  - `export()` (`src/core/observability.ts`) is the ring's lines only. It has no header, even though `session()` already knows the build and host.
  - Export is not safe to hand over. Two attributes carry absolute paths, and a desktop path includes the OS username:
    - `project.root`, on `project.open` (`src/core/project/project.ts`, `src/app/ProjectContext.tsx`)
    - `fs.path`, on `save` (`src/core/save/saveCoordinator.ts`)

    `client.error` carries `describe(error)`, which can include a server's response body. The 512-character cap limits size, not disclosure.

  - Five names in `OperationName` are only ever emitted as notes: `project.close`, `journal.write`, `journal.pending`, `project.watch`, `file.changed`.
  - Five areas emit nothing: catalogue browse, the review comparison, the cloud survey and plan, `/terms`, `/inventory`.

## Leans

### 1. No level ladder; `failed` is the alarm

A verdict is an outcome, not a severity. `refused` and `declined` are usually the app working, a rule holding or a person choosing no, so they are not warnings. The one bit that matters is **`failed` versus everything else**, and the operation and span hierarchy already provides the "debug vs trace" depth. A five-level ladder would add a second vocabulary that drifts from the first.

The gap is visibility (goal 5), which a ladder would not fix:

- **In dev, the console stream prints `failed` by default** and nothing else unless asked. This is one line per failure, not a stream of everything, so it respects goal 6.
- **A second, small ring holds the last 200 events that are not `passed`,** so typing cannot overwrite a failure. `errors()` reads it, and export leads with it.
- **The stream can also filter by verdict:** `stream({ verdicts: ["failed", "refused"] })` and a matching `VITE_SEFER_STREAM` form, beside the name prefixes.

### 2. One front door for writing

`operation` / `span` / `note` is the only API app code writes through. Effect's `Logger` stays as plumbing.

- `stateFailed` and "fix discarded" become notes: `failed` and `declined`, with the book and the reason.
- A new `console.*` in `src/` is a lint error, except in the renderers (`platform/observability.ts`) and composition's one boot warning. This is an oxlint `no-console` override.
- `Effect.withSpan` is fine inside Effect programs, but a user-visible piece of work opens an `operation`, so its name is in the closed `OperationName` list.

### 3. Named queries: the agent's filters (goal 3)

This serves goal 3 directly, and neither earlier draft had it.

Define about six queries as plain functions over an array of events, once, in core:

- `failures`: the non-`passed` ring, newest first
- `slow`: operations over their budget
- `operation(name)`: one operation with its spans, as a tree
- `before(seq, seconds)`: what happened in the N seconds before an event
- `keystrokes`: the p50/p95/p99 tail from the meter
- `compare(a, b)`: per-operation timing between two captures

Two doors reach the same functions, so the answers cannot drift:

- **In the app:** `__sefer.observability.query.<name>()`. An agent's Playwright script calls it directly.
- **Over a file:** `pnpm trace <file.jsonl> <query>` loads an export or a `.verify/<runId>/` capture and runs the same function. `jq` still works on the raw lines; this is the named layer above it.

**Guard:** the list stays short. A query is added when an agent or Will has asked the same question of traces twice.

### 4. The export contract (goal 4)

"Export diagnostics" under Settings → Advanced, in every build, writing JSONL.

**Line 1 is a header** with `schema: 1`:

- the build id, tag and channel
- the host (web or desktop), OS and version, WebView or browser version, and user agent
- when the session started, the events dropped, and the age of the oldest surviving event in each ring
- the configured endpoints: the `VITE_SEFER_*` URLs ship in the public bundle, so they are not secret. A user-edited endpoint is included too, flagged as not the default.
- **the project snapshot, taken at export time and not on every event:**
  - whether a remote is configured
  - HEAD
  - ahead, behind or diverged
  - which of the nine sync states it is in, and when that was observed
  - how many books are unsaved
  - whether a journal is pending

  A fact the host cannot answer is written as `"unknown"`, never guessed.

**Then the failure ring, then the main ring,** in the same event shape as today. Field names follow OTel's where they overlap (trace and span ids already do), so converting to OTLP later is a script, not a format change.

**Safety: an allowlist, not a denylist.** Recording stays as it is, because in dev you want the full path. Export is a separate renderer:

- Only attribute keys on an explicit list pass.
- Paths become project-relative, or `~` for the home directory.
- `client.error` detail becomes the error's type plus a scrubbed, short message.
- A key not on the list is written as `"redacted"`, not dropped, so a missing attribute is visible and someone adds it.

With a lot of generated code adding attributes, an allowlist fails safe and a denylist does not. It excludes account names and tokens outright.

### 5. Performance (goal 6)

- **The measurement is a script, not a one-off,** so it can be rerun as coverage grows: something like `pnpm verify:perf`, built on `verify:launch`.
- **What it measures:**
  - the keystroke tail and heap at `off` versus `all`
  - event rate, and how many minutes the ring covers during ordinary editing
  - whether the queue drops events, once there is a sink
- **Workload:** typing in a large book (en_ulb Genesis or Psalms), plus one project open and one comparison.
- **Rule:** if `all` costs under a few percent on the tail, it stays the default. If not, production drops to `spans` and the doc says why.
- **Where it runs:** first on a laptop against the Web build, then desktop.
- **Write rules for any sink:** batch, flush when the browser is idle, never write per event.

### 6. Persistence (goals 6 and 7): only if the ring's coverage says so

- **Desktop:** if the measured ring covers too little time to catch a real incident, or support needs evidence after a restart, write JSONL under HostInfo's `logs` root.
  - The queue is bounded and flushed when idle.
  - The total is capped (about five 1 MB files), and anything older than about seven days is deleted.
  - Export then includes the previous session.
- **Web:** writes nothing until a need is shown.
- **The console stream** stays dev-only in releases.

### 7. Coverage: as work touches it

This is not a blanket pass.

- **Before the primitives refactor, instrument what it touches:** Find, findings navigation, the reference pane and Key terms. The refactor is then checked against before-and-after traces.
- **`review.compare`** before the diff and sync model is designed, because it measures what `compareBooks` costs.
- **Catalogue, the cloud survey and plan, and `/inventory`:** the next time work touches each.
- **The five note-only names:** make them operations where they are one piece of work (`project.close`, `journal.write` with a cause); otherwise remove them from `OperationName`.
- **The rules that already hold:**
  - fields are primitives
  - text is capped at 512 characters
  - no query text and no scripture in a field
  - spans only at boundaries

### 8. The Effect runtime does not reach every corner

This is by design. The editor's interaction path is synchronous and never a fiber (see [INVARIANTS](../../documentation/INVARIANTS.md)). The rule is that every corner writes to the same ring through the same API, not that every corner runs under Effect.

## Order

1. **The agent-facing pass** (about a day):
   - the two `console` holes and the lint rule
   - `failed` shown in the dev console
   - the failure ring
   - the named queries, including the `pnpm trace` door
   - instrumenting what the primitives refactor touches
   - the perf script, run once for a baseline
2. **The primitives consolidation,** checked against traces.
3. **The export contract** (4): the header, the snapshot, the allowlist and the button.
4. **Desktop persistence** (6), if the coverage number calls for it.

## Not in scope

- A replay recorder, capture sessions, or any phone-home telemetry (ruled out in INVARIANTS).
- A severity ladder.
- OTLP as the export format.
- Changing the event shape or the assembler.
