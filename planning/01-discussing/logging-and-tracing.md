# Logging and tracing: evidence agents can read

**Status:** 2026-09-24. **Implemented, except where "Open after the pass" says otherwise.** The design now lives in [observability](../../documentation/architecture/observability.md) (the alarm, the failure ring, disk and export, the `jq` recipes, the Operations table); this doc keeps the reasoning, the baseline and what is still open. Delete it once the open items are settled.

## Open after the pass

1. **Disk cap vs volume.** At `all`, continuous typing writes about 745 KB a minute (after a keystroke stopped recording phases the clock could not see; it was 974). 5 MB therefore holds roughly seven minutes of non-stop typing, or perhaps half an hour of real editing. Choose: raise the cap (20 MB is still small), write a slimmer record to disk than the ring keeps (drop the `derive.*` notes, which exist only at `all`), or accept that the disk is the last half hour and the failure ring is the long memory.
2. **The meter's `editor.js_ms` overstates a keystroke's JS work** about twofold once a line wraps: nearly all of it is `editor.unaccounted_ms`, probably CodeMirror's measure pass counted into the gesture. Not confirmed.
3. **`terms.load` runs twice** when /terms is revisited. Seen in traces; not changed.
4. **Not yet seen at runtime**, because the fixture has no repository or remote: `sync.plan`, the `unavailable` endings of `sync.transfer` and `import.remote`, `update.install` (desktop), `reference.pair`, and the desktop log directory.
5. `analysis.warm` is in `OperationName` and nothing opens it.

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
- **A second, small ring holds the last 200 events that are not `passed`,** kept at recording time (decided 2026-09-24), so typing cannot overwrite a failure. `errors()` reads it, and export leads with it.
- **An expected failure does not trip the alarm (decided 2026-09-24).** Examples: being offline, a server that is down or slow, a timeout, a host without a capability. These get their own verdict, `unavailable`, meaning the world said no, and not `failed`, meaning our code or an invariant broke. It is a sibling outcome beside `refused` and `declined`, not a severity level.
  - It is set only at the known outside boundaries: the Remote port, the catalogue, the language API, the updater, and `fetch`.
  - Everywhere else, anything uncaught stays `failed`. A bug cannot hide as `unavailable` by default.
  - It still lands in the failure ring and in export, because support wants to know someone was offline. It just doesn't print in dev.
- **The stream can also filter by verdict:** `stream({ verdicts: ["failed", "refused"] })` and a matching `VITE_SEFER_STREAM` form, beside the name prefixes.

### 2. One front door for writing

`operation` / `span` / `note` is the only API app code writes through. Effect's `Logger` stays as plumbing.

- `stateFailed` and "fix discarded" become notes: `failed` and `declined`, with the book and the reason.
- A new `console.*` in `src/` is a lint error, except in the renderers (`platform/observability.ts`) and composition's one boot warning. This is an oxlint `no-console` override.
- `Effect.withSpan` is fine inside Effect programs, but a user-visible piece of work opens an `operation`, so its name is in the closed `OperationName` list.

### 3. Named filters: the agent's view (goal 3)

**Decided 2026-09-24: dump and `jq`.** There is no query API and no `pnpm trace` tool for now. An agent gets the lines one of two ways: `export()` from a Playwright script into `.verify/<runId>/`, or, once persistence lands (6), the log file on disk. It then filters with `jq`.

"A known set of filters" is a short list of `jq` recipes in [observability](../../documentation/architecture/observability.md):

- failures
- operations over their budget
- one operation and its spans
- the N seconds before an event
- the keystroke tail
- per-operation timing between two captures

A recipe is added when the same question has been asked of traces twice. A query layer in code waits until the recipes get unwieldy.

### 4. The export contract (goal 4)

"Export diagnostics" under Settings → Advanced, in every build, writing JSONL.

**Line 1 is a header** with `schema: 1`:

- the build id, tag and channel
- the host (web or desktop), OS and version, WebView or browser version, and user agent
- when the session started, the events dropped, and the age of the oldest surviving event in each ring
- the configured endpoints: the `VITE_SEFER_*` URLs ship in the public bundle, so they are not secret. A user-edited endpoint is included too, flagged as not the default.
- **the project snapshot, taken at export time and not on every event:**
  - whether a remote is configured
  - HEAD (decided 2026-09-24: included, since translation repos are public)
  - ahead, behind or diverged
  - which of the nine sync states it is in, and when that was observed. It is the last state the app saw, never a live check at export time, which would make export wait on a slow network (decided 2026-09-24).
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
  - event rate and bytes per minute of ordinary editing, which set the disk caps in (6)
  - whether the pending list ever drops events, and the idle-flush cost
- **Workload:** typing in a large book (en_ulb Genesis or Psalms), plus one project open and one comparison.
- **Rule:** if `all` costs under a few percent on the tail, it stays the default. If not, production drops to `spans` and the doc says why.
- **Where it runs:** first on a laptop against the Web build, then desktop.
- **Write rules for any sink:** batch, flush when the browser is idle, never write per event.

#### Baseline, 2026-09-24

`pnpm verify:perf --runs 5` (200 chars at 150 ms, 20 warm-up, medians of five runs, levels alternating order), on an Apple M1 Max, 32 GB, macOS 26.5.2, Playwright's headless Chromium (1.63), against the **dev server** over the fixture's Psalms (3 KB, USFM mode). Master at `f9e3c7f`. Run `.verify/2026-09-24T16-47-13-934Z-5fd1fbb7`.

|                                             | `off`              | `all`                  | all vs off                  |
| ------------------------------------------- | ------------------ | ---------------------- | --------------------------- |
| key handlers (Event Timing) p50 / p95 / p99 | 4.2 / 6.7 / 8.2 ms | 4.4 / 6.7 / 7.9 ms     | +5% / 0% / −4%              |
| input-to-paint (Event Timing) p95 / p99     | 16 / 16 ms         | 24 / 24 ms             | one 8 ms quantum; see below |
| frame-trick paint p95 / p99                 | 18.8 / 23.2 ms     | 19.9 / 21.8 ms         | +6% / −6%                   |
| meter `editor.js_ms` p50 / p95 / p99        | —                  | 8.2 / 14.2 / 16.7 ms   |                             |
| meter `editor.to_paint_ms` p95              | —                  | 30 ms (mostly `frame`) |                             |
| JS heap after GC                            | 37.5 MB            | 39.1 MB                | +1.6 MB                     |
| events / min                                | 0                  | 2,400                  |                             |
| JSONL bytes / min                           | 0                  | 974 KB                 |                             |
| minutes the 2,000-event ring covers         | —                  | 0.83                   |                             |
| failure ring                                | 0                  | 0                      |                             |
| project open (click → book list)            | 124 ms             | 127 ms                 |                             |
| Compare (click → "1 book(s) differ")        | 111 ms             | 109 ms                 |                             |

What it says:

- **`all` costs nothing measurable on the keystroke tail** here: the handlers' p95 is identical and p99 is inside run-to-run noise. By the rule above, `all` stays the default — pending a run against a build and a large book.
- **The input-to-paint "+50%" is not a cost.** Event Timing rounds to 8 ms, and each run's p95 lands on 16 or 24 ms: two of five `off` runs read 24, three of five `all` runs. The median across runs flips one quantum.
- **Bytes, not time, are the constraint.** Continuous typing records ~6 events and ~2.4 KB per keystroke; `editor.mutation` alone is ~1.2 KB a record (its per-phase `editor.phase.*.ms` attributes) and half the bytes. At that rate the 5 MB disk cap in (6) holds about five minutes of continuous typing, and the ring under a minute. Real editing pauses, so this is an upper bound, but the caps (or the mutation record's width) need a decision before they are fixed.
- **The meter's `js_ms` is not the key's JS work.** It runs about twice the handlers' time, and it jumps from ~1.5 ms to ~8 ms roughly when the typed line starts to wrap — nearly all of it `editor.unaccounted_ms`, i.e. a later update (CodeMirror's measure pass) after the key's own task. And in headless the meter's `to_paint` mostly comes from the frame trick (reads ~30 ms) where Event Timing says 16–24.

Not measured yet: the disk sink's pending-list drops and idle-flush cost (over the fixture the sink writes nothing — `startLogFiles` skips it), a production build, en_ulb, and desktop.

### 6. Persistence (goals 3, 6 and 7): write everything, bounded by age and size

**Lean (Will, 2026-09-24): flush every recorded event to disk.** The ring's 2,000 events is then only a memory bound: enough for the dev surface and the failure ring's neighbours, small enough not to pressure the Web heap or the GC. It stops being the retention promise.

**Why this beats "only if coverage says so":**

- **Nothing is lost** when the ring wraps or the app restarts.
- **Export can include earlier sessions.**
- **Agents read the file directly** (goal 3): on desktop, an agent can `jq` the log without driving the app.

**How it stays cheap (goal 6):**

- `push` stays as it is: one object into the ring, and no serialising on the hot path.
- A pending list is drained when the browser is idle (`requestIdleCallback`, with a timeout), and on `pagehide` / close. Serialising and writing happen there, in one append per batch.
- The pending list is bounded. When full, the oldest pending events are dropped and counted, and the count goes in the next header and in `session()`. Recording never blocks on disk.
- At level `off` nothing is written.

**How it stays small (goal 7):**

- One JSONL file per session, starting with the same header export writes.
- A total cap of about 5 MB, with the oldest session deleted first, and anything older than about seven days deleted at boot.
- These numbers get checked against the perf script's event rate before they're fixed.

**Hosts:**

- **Desktop:** under HostInfo's `logs` root.
- **Web:** the same sink over OPFS, in its own directory beside projects. It follows the same caps, and 5 MB is negligible against project storage.
- **Dev and Node:** the existing `hostSink` stderr path.

**The files hold full paths:** they are local, like the projects themselves. The allowlist (4) applies when anything is handed over, not when it is written.

**The console stream** stays dev-only in releases.

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
   - the `jq` recipes in the observability doc
   - instrumenting what the primitives refactor touches
   - the perf script, run once for a baseline
2. **The primitives consolidation,** checked against traces.
3. **Persistence** (6), on both hosts. The header is shared with export, so it is built here.
4. **The export contract** (4): the snapshot, the allowlist and the button, reading the files from (6).

## Not in scope

- A replay recorder, capture sessions, or any phone-home telemetry (ruled out in INVARIANTS).
- A severity ladder.
- OTLP as the export format.
- A query API or `pnpm trace` tool, for now (3).
- Changing the event shape or the assembler.
