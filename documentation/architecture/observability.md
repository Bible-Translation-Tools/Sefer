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

Sinks are the host's job, in `src/platform/observability.ts`. `hostSink()` returns a stderr writer that emits each JSONL line under a Node-shaped host, and in a browser or webview a sink that mirrors `note` events to `console.debug`. **Both are opt-in, behind the same `SEFER_LOG` / `VITE_SEFER_LOG`.** The console sink used to be on for every dev build and was the single most expensive thing on the keystroke path — a `console.debug` per note, and the ring builds a JSONL line with `JSON.stringify` whenever any sink exists at all, so about a third of a keystroke's JS work was spent reporting the keystroke. Nothing is lost by the default silence: the ring holds every event either way, and `__sefer.observability.recent()` is how it is read. `pnpm verify:launch` sets the variable itself, so `.verify/<runId>/observability.jsonl` is unchanged.

`installObservabilityDevSurface(service)` publishes `globalThis.__sefer.observability = { recent, export, level, setLevel }` when `import.meta.env.DEV`, and nothing in production. Core references neither `console` nor `globalThis`.

`src/app/composition.ts` builds the Layer at the root, runs `boot` inside it, and emits one `boot` span and one `boot` note (`ready` with `<host> <build>` and the build identity as correlation, or `failed` with the error tag).

`composeApplication(options)` is the one composition entry: it builds the Layer into a `ManagedRuntime`, runs `boot` on it, and returns `{ boot, observability, fileSystem, layer, runtime, dispose }` — see [composition](composition.md) for why the runtime, not the program, owns the Layer's scope. `src/App.tsx` awaits it once with no options — the production root provides no `FileSystem` — and hands the result to every consumer through `useComposition()`. There is one ring per running application: the dev fixture route merges its seeded FileSystem over `composition.layer` instead of composing again, so its `fixture` note lands in the same ring beside the `boot` note.

## OTLP: exporting the ring

OTLP is a dev-only toggle in `composeApplication`, and it is a **sink on the ring**, not a second observability system. That is the shape it has to have, because Sefer's own instrument is the ring: `note()` and `span()` are plain function calls that push a record into a buffer, and `Effect.log` and `Effect.withSpan` appear nowhere in `src/`. An OTLP tracer and logger see only Effect-native spans and logs, so the exporters had nothing whatever to export and a configured run posted no request at all.

So `telemetryBridge()` builds the exporters into a `ManagedRuntime` **of their own** — separate from the application's, because `ObservabilityLive` installs its own `Tracer.Tracer` and replaces `CurrentLoggers`, and merging the two layers meant one silently discarded the other's — and returns an `ObservabilitySink`. Every ring event is forwarded through it: a `note` and a `log` become an OTLP log record annotated with `sefer.verdict`, `sefer.detail` and `sefer.correlation`; a `span` becomes a real span ended the `ms` the ring measured after it began. There is no loop, because that runtime's logger set is the OTLP one alone (`mergeWithExisting: false`) and never reaches the ring.

Run it with — and this exact command is verified against motel:

```sh
export VITE_SEFER_OTLP_URL=http://127.0.0.1:27686
pnpm dev
```

Two details that are easy to get wrong and were both wrong:

- **The browser never posts to the collector directly.** A collector is a different origin and an OTLP body is `application/json`, so the browser sends a CORS preflight — and motel answers `OPTIONS /v1/logs` with a bare 404 and no `Access-Control-Allow-Origin`. The preflight fails, the POST is never made, and nothing appears anywhere: no request on the wire, no error the collector can report. `vite.config.ts` therefore proxies `/__otlp` to `VITE_SEFER_OTLP_URL` whenever it is set, and the exporters post to `"/__otlp/v1/traces"` and `"/__otlp/v1/logs"` — same-origin, so there is no preflight and no collector configuration to get right. The variable is read with `loadEnv`, so `export`ing it in the shell that runs `pnpm dev` is enough.
- **Each signal has its own guarded fetch.** `guardedFetch` warns once and then refuses locally, so a collector that is not there cannot fill the console with `net::ERR_FAILED`; one shared instance meant a single endpoint the collector does not serve stopped every other signal too. Metrics stay opt-in (`VITE_SEFER_OTLP_METRICS=1`) for the same reason: motel takes `/v1/traces` and `/v1/logs` and answers `/v1/metrics` with nothing at all.

Confirmed working: with the variable exported, motel answers `{"insertedLogs": 171}` and `{"insertedSpans": 155}` for one page load plus five keystrokes; with it unset, the page makes no telemetry request at all. The imports are dynamic and inside the `import.meta.env.DEV` branch, so a production build contains no OTLP code: `grep -r Otlp dist/` comes back empty. The bridge builds asynchronously, which is why the composition is a `Promise` and `src/App.tsx` uses top-level `await`; `dispose()` closes the application runtime first and the exporters last, so the final batch is flushed.

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

When a book is mounted, the editor's `keystrokeMeter` closes one gesture per DOM event and writes one bounded note per gesture, correlated by book id:

```text
keystroke · ready · gesture=4.6ms render=21.3ms analyzes=1 analyze=2.1 decorate=1.0 scan=0.7 paint=0.3 phase:admission=0.1 other=0.4
```

Read it left to right:

- **`gesture`** — the JS work: the DOM event to the LAST state update of the gesture. This is the part Sefer's own code owns.
- **`render`** — the same event to after the browser painted, measured by waiting a frame and then a macrotask inside it (a `requestAnimationFrame` callback runs *before* the paint). Omitted entirely when no frame was observed — a headless state, a background tab — rather than printed as a guess. It is always larger than `gesture` and it is not a sum: between the last update and the paint sit CodeMirror's measure pass, style and layout.

  **Read it with its floor in mind.** Because the measurement waits for the next frame, `render` can never be less than the gap to the next vsync plus the macrotask after the paint — about 17 ms on a 60Hz display, however fast the gesture was. A measured `gesture=1.8ms render=17.0ms` is a keystroke with nothing wrong with it. What is worth chasing is `render` that is several frames: `gesture=8.7ms render=78.1ms` is four or five frames of waiting, and by construction none of that time is inside the gesture — it is a main thread or a compositor that is behind. The usual causes are work scheduled off the gesture (a `requestAnimationFrame` chain, an observer), and compositing the editor is expensive for reasons no JS profile shows — which is why the sticky location bar carries no `backdrop-filter` any more.
- **`analyzes`** — parses the gesture actually caused, counted by `Analysis.revision` moving, so a memo hit is not counted.
- **the per-span totals** — exclusive milliseconds per span inside the gesture, biggest first: `analyze` (the engine parse, timed in `core/analyzer.ts`), the derivation spans `scan`, `index`, `decorate`, `paint`, and one `phase:<name>` per editing phase that cost anything. Buckets under 0.05 ms are dropped from the line.
- **`other`** — gesture milliseconds no span accounted for.

**The arithmetic closes:** every printed span plus `other` sums to `gesture`. That is why the meter opens no span of its own — the old note printed a `keystroke=` wrapper span whose exclusive time ran past the last update to the macrotask that closed it, so the numbers added up to nothing in particular and the one wall number was ambiguous between JS work and time to paint.

In a dev build `globalThis.__sefer.editor` exposes `keystrokes()` (the last fifty measurements whole — `{ gesture, render, analyzes, totals, other, note }`), `spans()` and `summary()` from the editor's timing ring, plus `traces()` and `trace()` from the pipeline instrument. The engine's own `analyze` span lands in this ring separately, under the Galley adapter.

The editor's per-transaction instrument (`src/editor/core/instrument.ts`) writes this ring through `observabilityTracer`, which reads the level ONCE when a trace begins. At `verdicts` it writes one note per transaction, and only when a stage did not pass — the first such stage, which is the one a `Refusal` names; a paragraph of ordinary typing writes nothing. At `spans` and `all` it also writes a span per pipeline frame (`editor.phase.<name>`, `editor.command.<name>`) and a note per frame verdict, in pipeline order, so `recent()` reads as the keystroke's flow through the rules. Every one carries the correlation `<bookId>#<trace seq>`. Derivation spans (`scan`, `index`, `decorate`, `paint`) never cross: they run several times per keystroke and the meter's one note already carries their exclusive totals. See [Editor › Instrumentation](editor.md#instrumentation).

Measured 2026-09-08 on the Psalms fixture in the dev build: `boot` 0 ms (it only validates the host and build), `project.open` ~3 ms for five books, the initial `analyze.project` ~20 ms, warm `analyze` per keystroke ~0.5 ms (7 ms cold), keystroke wall 2–3 ms warm and ~11 ms for the first keystroke after mount.
