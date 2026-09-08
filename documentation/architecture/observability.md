# Observability shorthand

Status: working guidance for experiments. The design remains provisional in [`planning/00-ideas/local-observability-and-agent-evidence.md`](../../planning/00-ideas/local-observability-and-agent-evidence.md).

## Current scaffold

Status: this section describes code that exists. Everything below it is the agreed direction, not a claim about the tree.

`src/core/observability.ts` defines the `Observability` service (an Effect 4 `Context.Service`) with four operations plus volume:

- `span(name, note?) => () => number` — synchronous and nestable. The returned closer records inclusive `ms` and exclusive `self` (inclusive minus the time billed to spans opened and closed inside it) and returns the inclusive milliseconds. Below level `spans` it is two `performance.now()` reads and records nothing.
- `note(rule, verdict, detail?, correlation?)` — synchronous. `verdict` is the closed union `ready | passed | refused | rewrote | consumed | declined | failed`.
- `recent(limit?)` — the newest events, oldest first.
- `export()` — JSONL, one event per line, each line terminated by a newline.
- `level()` / `setLevel(level)`.
- `dropped()` — how many events the sink refused, by throwing.

Volume is `off | verdicts | spans | all`: `off` records nothing; `verdicts` records `note` and Effect `Logger` output; `spans` adds the synchronous `span` events; `all` adds spans created by `Effect.withSpan`. The default is `all`.

Storage is one fixed ring buffer, default 2 000 events, size set by the Layer's `capacity` option. The oldest event is overwritten; nothing grows.

A sink is host code and may do anything, including throw. `push` calls it inside a `try`/`catch`: a throwing sink increments `dropped()` and is never rethrown, so `note()` and a span's closer return normally and the event is still in the ring. Telemetry is dropped under pressure and counted; it never changes domain behaviour.

`name` and `detail` are truncated to `MAX_TEXT` (512) characters before the event is recorded, so one runaway string cannot bloat the ring or a sink line. The cap is applied on the way in, so `recent()` and `export()` agree.

Recorded event fields, in the order `export()` writes them: `seq`, `t` (epoch milliseconds), `kind` (`span | note | log`), `name` (the span name or the note's rule), `verdict`, `detail`, `ms`, `self`, `correlation`. Absent fields are omitted from the line.

`ObservabilityLive(options)` in core builds the ring and merges three layers: the service itself, `Logger.layer` with a logger that writes every `Effect.log*` into the ring as a `log` event (`name` is the message, `detail` is the Effect log level, `verdict` is `failed` for `Error` and `Fatal`), and `Tracer.Tracer` replaced by a tracer that wraps `Tracer.NativeSpan` and records each span as it ends, correlated by its `traceId`. Because the logger layer replaces the default, `Effect.log*` no longer writes to the console on its own.

Sinks are the host's job, in `src/platform/observability.ts`. `hostSink()` returns a stderr writer that emits each JSONL line when `SEFER_LOG` or `VITE_SEFER_LOG` is set under a Node-shaped host and is silent otherwise; in a browser or webview it returns a sink that mirrors `note` events to `console.debug` in dev builds only. `installObservabilityDevSurface(service)` publishes `globalThis.__sefer.observability = { recent, export, level, setLevel }` when `import.meta.env.DEV`, and nothing in production. Core references neither `console` nor `globalThis`.

`src/app/composition.ts` builds the Layer at the root, runs `boot` inside it, and emits one `boot` span and one `boot` note (`ready` with `<host> <build>` and the build identity as correlation, or `failed` with the error tag).

`composeApplication(options)` is the one composition entry: it builds the Layer into a `ManagedRuntime`, runs `boot` on it, and returns `{ boot, observability, fileSystem, layer, runtime, dispose }` — see [composition](composition.md) for why the runtime, not the program, owns the Layer's scope. `src/App.tsx` awaits it once with no options — the production root provides no `FileSystem` — and hands the result to every consumer through `useComposition()`. There is one ring per running application: the dev fixture route merges its seeded FileSystem over `composition.layer` instead of composing again, so its `fixture` note lands in the same ring beside the `boot` note.

OTLP is a dev-only toggle in `composeApplication`. When `import.meta.env.DEV` and `VITE_SEFER_OTLP_URL` is set, the composition dynamically imports `effect/unstable/observability/Otlp` and `effect/unstable/http/FetchHttpClient` and merges `Otlp.layerJson({ baseUrl, resource: { serviceName: "sefer" } })`, fed by the fetch `HttpClient`, beside `ObservabilityLive`. `Effect.log*` and `Effect.withSpan` inside the composed program then reach the collector as well as the ring. Run it with

```sh
VITE_SEFER_OTLP_URL=http://localhost:4318 pnpm dev
```

and point any OTLP-HTTP viewer at `http://localhost:4318`; the layer posts to `/v1/logs`, `/v1/metrics`, and `/v1/traces` below that URL. The imports are dynamic and inside the `import.meta.env.DEV` branch, so a production build contains no OTLP code: `grep -r Otlp dist/` comes back empty. Note that the OTLP Layer builds asynchronously, which is why the composition is a `Promise` and `src/App.tsx` uses top-level `await`.

Not present yet: JSONL files on disk, rotation, retention, batching, run IDs, and any editor instrumentation.

## Boundary

Application code uses **Effect Logger and Effect spans**. Do not call Effect Logger and the Tauri logger as parallel application APIs.

Treat Tauri logging as a candidate **desktop sink and Rust bridge**. Web development uses console plus bounded memory. Motel is an optional local OTLP viewer.

```text
CodeMirror / application operation
  -> structured event or Effect span
  -> bounded, non-throwing sink
  -> async batch drain
       -> console / recent-N
       -> desktop JSONL through the chosen native adapter
       -> optional OTLP to Motel
```

## Hot-path rules

- Keep CodeMirror policy and synchronous Galley work synchronous.
- Do not perform IPC, filesystem/exporter work, or create an async task per editor event.
- Record compact decisions: stable event/rule, verdict/reason, revision, operation ID, and safe metadata.
- Observe refused or consumed input even when it creates no transaction.
- Use spans for meaningful operations and duration; use events to explain decisions.
- Drop telemetry under pressure and count the loss. Never alter editor behavior.

Async save/backup work carries its captured revision and produces an observable receipt. Explicit save does not advance its baseline until the matching write succeeds.

## Levels

- `off`: disabled.
- `error`: unexpected failures.
- `info`: lifecycle and major-operation outcomes.
- `debug`: revision, scheduling, and analysis summaries.
- `trace`: individual editor decisions and detailed safe metadata.

Expected defaults: development `debug`, isolated verification `trace`, production `info`. A production troubleshooting override normally expires on restart.

Never record manuscript text, clipboard/search contents, tokens, full paths, or arbitrary objects. Levels restrict payload as well as volume.

## Agent queries

Start without a capture-session protocol. Assign an optional run ID at verification launch. Query recent records from the development buffer, JSONL with `jq`/`rg`/`tail`, or Motel when explicitly running.

An ordinary `verification.step` event may correlate a UI action. Use bounded flush for shutdown/evidence export. Add an API only after direct query paths fail a real workflow.

## Instrumentation checklist

1. Name the diagnostic question.
2. Emit at the seam that knows the answer; avoid downstream duplication.
3. Use a stable event name and reason code.
4. Include correlation and revision fields needed for ordering.
5. Exclude project content and secrets.
6. Check behavior with telemetry off and with a full/broken sink.
7. Measure hot-path cost when adding editor or Galley detail.

Keep the application schema independent of the native writer. Tauri JSONL preservation, batching, rotation, cross-platform paths, and bounded retention remain probe questions.

## The keystroke meter

When a book is mounted, the editor's `keystrokeMeter` closes one gesture per DOM event and writes one bounded note per gesture: `keystroke · ready · <wall ms> analyzes=<n> <span>=<ms> …`, correlated by book id. The wall time is DOM event to last CodeMirror update; the per-span totals (`phase:*`, `scan`, `index`, `decorate`, `paint`) come from the editor's own timing ring, and the engine's `analyze` span lands in this ring separately under the Galley adapter. In a dev build `globalThis.__sefer.editor` exposes `keystrokes()` (the last fifty measurements whole), `spans()` and `summary()` from that ring, plus `traces()` and `trace()` from the pipeline instrument.

The editor's per-transaction instrument (`src/editor/core/instrument.ts`) writes this ring through `observabilityTracer`, which reads the level ONCE when a trace begins. At `verdicts` it writes one note per transaction, and only when a stage did not pass — the first such stage, which is the one a `Refusal` names; a paragraph of ordinary typing writes nothing. At `spans` and `all` it also writes a span per pipeline frame (`editor.phase.<name>`, `editor.command.<name>`) and a note per frame verdict, in pipeline order, so `recent()` reads as the keystroke's flow through the rules. Every one carries the correlation `<bookId>#<trace seq>`. Derivation spans (`scan`, `index`, `decorate`, `paint`) never cross: they run several times per keystroke and the meter's one note already carries their exclusive totals. See [Editor › Instrumentation](editor.md#instrumentation).

Measured 2026-09-08 on the Psalms fixture in the dev build: `boot` 0 ms (it only validates the host and build), `project.open` ~3 ms for five books, the initial `analyze.project` ~20 ms, warm `analyze` per keystroke ~0.5 ms (7 ms cold), keystroke wall 2–3 ms warm and ~11 ms for the first keystroke after mount.
