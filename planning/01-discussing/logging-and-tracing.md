# Logging and tracing: one model, fewer gaps

**Status:** 2026-09-23. Discussion, not a plan. The leans below are proposals for Will to rule on. The current design is in [observability](../../documentation/architecture/observability.md); this doc is only about what is unsettled.

**The value this serves:** runtime evidence is harder to make lie than a doc or a test pinning odd behaviour, so tracing should be extensive, and only cut back where a measurement shows it costs.

## Where things stand

- **One ring, wide events.** Operations (`boot`, `project.open`, `save`, `find.run` and so on), spans inside them, and notes carrying a verdict (`passed`, `refused`, `failed`, …). The ring holds 2,000 events, and the level `off | verdicts | spans | all` defaults to `all` in every build.
- **Three renderers, all fed by the one assembler:** the dev rings behind `__sefer.observability`, the console stream (`VITE_SEFER_STREAM` or `stream()`), and the dev-only OTLP bridge to a collector.
- **Two write APIs in theory, one in practice.** App code writes through `operation()` / `span()` / `note()`: 19 operation sites and about 50 notes. Effect's `Logger` is also routed into the ring, but `Effect.log` appears only inside the OTLP bridge, and `Effect.withSpan` once.
- **Client failures** are `client.error` notes since today: boundary-caught, uncaught and unhandled rejections.
- **Holes:**
  - `console.error` in `src/editor/core/trace.ts` (`stateFailed`) and `console.warn` in `src/editor/recipes/lint.ts` ("fix discarded") bypass the ring entirely.
  - Five names in `OperationName` are only ever emitted as notes: `project.close`, `journal.write`, `journal.pending`, `project.watch`, `file.changed`.
  - Five areas emit nothing: catalogue browse, the review comparison, the cloud survey and plan, `/terms`, `/inventory`.
- **Not decided:**
  - whether a severity ladder should exist
  - what production records
  - whether anything persists on desktop
  - whether a release can hand evidence to a person helping

## The questions, with leans

### 1. Log levels (`error / info / debug / trace`): do we need them?

**Lean: no ladder.** The verdict already is the severity: `failed` is an error, `refused` / `declined` are warnings, and the rest is information. The operation and span hierarchy is the "debug vs trace" depth. A second ladder would be a second way to say the same thing, and it would drift from the first.

What we do want is to FILTER by verdict. For example, `stream({ verdicts: ["failed", "refused"] })` and a matching `VITE_SEFER_STREAM` form, beside the existing name prefixes. That is a filter over what the ring already holds, not a new axis.

### 2. One front door for writing

**Lean: `operation` / `span` / `note` is the only API app code writes through.** Effect's `Logger` stays as plumbing, fed from the ring out to OTLP, and is not a second door for app code. Concretely:

- `stateFailed` and the "fix discarded" warning become notes: `failed` and `declined`, with the book and the reason.
- A new `console.*` in `src/` is a lint error, except in the renderers (`platform/observability.ts`) and composition's one boot warning. That is a small oxlint `no-console` override, so the hole cannot reopen.
- `Effect.withSpan` is fine inside Effect programs, which is what the `all` level is for. But a user-visible piece of work opens an `operation`, so it has a name in the closed `OperationName` list.

### 3. What production records

**Lean: keep `all` until a measurement says otherwise.** Take one measurement, once, and write down the numbers either way:

- **Setup:** a large book (en_ulb Genesis or Psalms) on a mid-range machine.
- **Measure:** the keystroke tail (p95/p99 from the existing meter) and heap, with the level at `off` and at `all`.
- **Rule:** if `all` costs under a few percent on the tail, it stays the default everywhere; if not, production drops to `spans` and the doc says why.

This follows the frame-budget invariant: investigate only a measured cost.

### 4. Coverage: close the holes

**Lean: do it as one small pass**, because it is instrumentation, not behaviour:

- Make the five note-only names real operations where they are one piece of work (`project.close`, `journal.write` with a cause), or drop them from `OperationName` where a note is the honest shape.
- Instrument the silent areas with one operation each, carrying counts and timing, never content:
  - `catalogue.browse`
  - `review.compare` (which also measures what `compareBooks` costs; see the diff and sync model)
  - `sync.survey` / `sync.plan`
  - `terms.load`
  - `inventory.load`
- Keep the rules that already hold:
  - fields are primitives
  - text is capped at 512 characters
  - no query text and no scripture in a field
  - spans only at boundaries

### 5. Persistence and handing evidence over

**Lean, in order of value:**

1. **"Export diagnostics" in every build**, under Settings → Advanced: `export()` as a JSONL file the user can send. This is the cheapest thing that makes a release debuggable, and it needs no new format.
2. **Desktop JSONL on disk** under HostInfo's `logs` root: a bounded queue, batched writes, and rotation by size. Correlating with Rust logs (`tauri-plugin-log`) comes later, if the Rust side ever needs it.
3. **The console stream in a release:** leave it dev-only. Export covers support, and a live stream in someone's translation session is a foot-gun of the same kind the design surface is.

### 6. The Effect runtime does not reach every corner

That is by design and should stay so. The editor's interaction path is synchronous and never a fiber (see [INVARIANTS](../../documentation/INVARIANTS.md)), so the editor instruments itself with `span()` / `note()` and the keystroke meter. The rule is that every corner writes to the same ring through the same API, not that every corner runs under Effect.

## Order relative to the primitives consolidation

**Lean: this pass first, kept small.** Items 1, 2 and 4, plus the measurement in 3. Persistence and export (5) can follow.

The primitives work changes Find, Findings navigation, the reference pane and Key terms. Instrumenting those paths first means the refactor is checked against before-and-after traces rather than by eye. That is the runtime-evidence way to do a refactor that touches features. It also gives `review.compare` numbers before the diff and sync model is designed.

Against: it delays the primitives work by a pass. But the pass is a day or less, and it is additive only.

## Not in scope

- A replay recorder, capture sessions, or any phone-home telemetry (ruled out in INVARIANTS).
- Changing the event shape, or the assembler.
