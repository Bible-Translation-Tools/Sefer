# Observability shorthand

Status: working guidance for experiments. The design remains provisional in [`planning/00-ideas/local-observability-and-agent-evidence.md`](../../planning/00-ideas/local-observability-and-agent-evidence.md).

## Current scaffold

Status: this section describes code that exists. Everything below it is the agreed direction, not a claim about the tree.

`src/core/observability.ts` defines the `Observability` service (an Effect 4 `Context.Service`):

- `operation(name, attrs?, options?) => Operation` — opens ONE end-to-end piece of work, which in practice is one thing the user did. The returned `Operation` IS an `ObservabilityService`, plus `attr(attrs)`, `end(verdict?, attrs?)`, and its own `trace` and `id`.
- `span(name, note?, attrs?) => (attrs?) => number` — synchronous and nestable. The returned closer records inclusive `ms` and exclusive `self` (inclusive minus the time billed to spans opened and closed inside it) and returns the inclusive milliseconds. Below level `spans` it is two `performance.now()` reads and records nothing.
- `note(rule, verdict, detail?, attrs?)` — synchronous. `verdict` is the closed union `ready | passed | refused | rewrote | consumed | declined | failed`.
- `session()` — the id, build and host every event of this run has in common.
- `recent(limit?)` — the newest events, oldest first.
- `export()` — JSONL, one event per line, each line terminated by a newline.
- `level()` / `setLevel(level)`.
- `dropped()` — how many events the sink refused, by throwing.

Volume is `off | verdicts | spans | all`: `off` records nothing; `verdicts` records `note` and Effect `Logger` output; `spans` adds the synchronous `span` events; `all` adds spans created by `Effect.withSpan`. The default is `all`.

Storage is one fixed ring buffer, default 2 000 events, size set by the Layer's `capacity` option. The oldest event is overwritten; nothing grows.

A sink is host code and may do anything, including throw. `push` calls it inside a `try`/`catch`: a throwing sink increments `dropped()` and is never rethrown, so `note()` and a span's closer return normally and the event is still in the ring. Telemetry is dropped under pressure and counted; it never changes domain behaviour.

`name` and `detail` are truncated to `MAX_TEXT` (512) characters before the event is recorded, so one runaway string cannot bloat the ring or a sink line. The cap is applied on the way in, so `recent()` and `export()` agree.

Recorded event fields, in the order `export()` writes them: `seq`, `t` (epoch milliseconds), `kind` (`operation | span | note | log`), `name`, `verdict`, `detail`, `ms`, `self`, `trace`, `id`, `parent`, `attrs`. Absent fields are omitted from the line.

`attrs` is the wide half: `Record<string, string | number | boolean>`, capped at `MAX_ATTRS` (32) keys with string values through `MAX_TEXT`. Primitives only, and the type is the enforcement — an attribute holding a reference would be pinned alive by the ring for the next `capacity` events, which is how a bounded buffer becomes a leak. Prefer fields over sentences: `{ "book.id": id, "book.revision": 41 }` is queryable where `` `${id} r41` `` is not.

## How an operation propagates

`trace` is the OPERATION — one gesture — not a book and not a file; those are attributes OF the work. Every event carries the `trace` it belongs to and the `parent` span it happened inside, so a gesture reassembles into a tree.

Propagation is dependency injection, not ambient state and not a parameter threaded through core. An `Operation` is an `ObservabilityService`, so the gesture's door provides it — `Effect.provideService(Observability, operation)` — and core's existing `Effect.serviceOption(Observability)` receives it without knowing whether it is the root or a gesture's own. Correct across every await, because Effect's context lives on the fiber. **Core narrates; it does not know anyone is tracing.** No core module imports a span, a trace, or an exporter.

The editor is the exception, and deliberately so: its rules run inside `changeFilter` and `transactionFilter` on the keystroke path, where there is no fiber to carry a context. `src/editor/observability.ts` opens one `editor.transaction` operation per transaction and passes it down its own instrument.

Work that no gesture caused — a filesystem watcher, `boot` — carries no `trace` and exports as a root of its own. That is the honest shape, and it makes "which traces had no gesture behind them" a query.

`ObservabilityLive(options)` in core builds the ring and merges three layers: the service itself, `Logger.layer` with a logger that writes every `Effect.log*` into the ring as a `log` event (`name` is the message, `detail` is the Effect log level, `verdict` is `failed` for `Error` and `Fatal`), and `Tracer.Tracer` replaced by a tracer that wraps `Tracer.NativeSpan` and records each span as it ends, under its own `traceId` and `spanId`. Because the logger layer replaces the default, `Effect.log*` no longer writes to the console on its own.

Sinks are the host's job, in `src/platform/observability.ts`. `hostSink()` returns a stderr writer that emits each JSONL line when `SEFER_LOG` or `VITE_SEFER_LOG` is set under a Node-shaped host and is silent otherwise; in a browser or webview it returns a sink that mirrors `note` events to `console.debug` in dev builds only. `installObservabilityDevSurface(service)` publishes `globalThis.__sefer.observability = { recent, export, level, setLevel }` when `import.meta.env.DEV`, and nothing in production. Core references neither `console` nor `globalThis`.

`src/app/composition.ts` builds the Layer at the root, runs `boot` inside it, and emits one `boot` span and one `boot` note (`ready` with `<host> <build>` and the build identity as correlation, or `failed` with the error tag).

`composeApplication(options)` is the one composition entry: it builds the Layer into a `ManagedRuntime`, runs `boot` on it, and returns `{ boot, observability, fileSystem, layer, runtime, dispose }` — see [composition](composition.md) for why the runtime, not the program, owns the Layer's scope. `src/App.tsx` awaits it once with no options — the production root provides no `FileSystem` — and hands the result to every consumer through `useComposition()`. There is one ring per running application: the dev fixture route merges its seeded FileSystem over `composition.layer` instead of composing again, so its `fixture` note lands in the same ring beside the `boot` note.

OTLP is a dev-only toggle in `composeApplication`, and it is a SINK ON THE RING rather than a second Layer. The exporters only ever see Effect-native spans and logs, and `Effect.log`/`Effect.withSpan` appear nowhere in `src/` — the ring's `note()` and `span()` are plain function calls — so merging `Otlp.layerJson` beside `ObservabilityLive` exported nothing at all, and the two layers fought over the same `Tracer` and `CurrentLoggers`. Instead, when `import.meta.env.DEV` and `VITE_SEFER_OTLP_URL` is set, `telemetryBridge()` dynamically imports `OtlpTracer`, `OtlpLogger`, `OtlpMetrics`, `OtlpSerialization` and `FetchHttpClient`, builds a `ManagedRuntime` of its OWN from them, and returns a sink: every ring event is forwarded, a `note` or `log` as an OTLP log record and a `span` as a real span carrying the duration the ring measured. The ring keeps its own tracer and logger untouched, and there is no loop, because that runtime's logger set is the OTLP one alone.

The browser posts to the SAME-ORIGIN path `/__otlp`, which the dev server proxies to the collector. A collector is a different origin and an OTLP body is `application/json`, so a direct post is preflighted — and motel answers `OPTIONS /v1/logs` with a bare 404, so the preflight fails and the POST is never made, silently. `OTLP_PROXY_PATH` is declared in both `vite.config.ts` and `src/app/composition.ts`, beside the same explanation. Metrics stay opt-in behind `VITE_SEFER_OTLP_METRICS=1`, because motel serves `/v1/traces` and `/v1/logs` and answers `/v1/metrics` with nothing; each signal gets its own `guardedFetch`, which warns once and then refuses locally rather than filling the console with `net::ERR_FAILED` on every interval. Run it with

```sh
VITE_SEFER_OTLP_URL=http://127.0.0.1:27686 pnpm dev
```

and read it in motel on that same port — `motel tui`, or `http://127.0.0.1:27686/api/traces`. In the TUI, `[` and `]` cycle the service: it remembers the last one in `~/.local/state/motel/last-service.txt` and otherwise defaults to its own `motel-otel-tui`, which shows an empty trace list while Sefer is exporting perfectly well under `sefer`. The imports are dynamic and inside the `import.meta.env.DEV` branch, so a production build contains no OTLP code: `grep -r Otlp dist/` comes back empty. Note that the OTLP Layer builds asynchronously, which is why the composition is a `Promise` and `src/App.tsx` uses top-level `await`.

The bridge holds a gesture's events until its operation record arrives, because the ring writes the wide record LAST — everything known by the time the work finished — and an exporter needs the parent first. The hold is bounded (64 traces, 256 events each, oldest dropped): an operation that never ends must not grow it. Children are emitted inside the parent span's context, so the OTLP logger stamps each note with the trace and span it belongs to.

Not present yet: JSONL files on disk, rotation, retention, batching, and cross-process correlation with the Tauri host — a Rust `invoke` is one opaque child span, timed from the web side, which is the same shape Effect gives an async filesystem call.

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
- **`analyzes`** — parses the gesture actually caused, counted by `Analysis.revision` moving, so a memo hit is not counted.
- **the per-span totals** — exclusive milliseconds per span inside the gesture, biggest first: `analyze` (the engine parse, timed in `core/analyzer.ts`), the derivation spans `scan`, `index`, `decorate`, `paint`, and one `phase:<name>` per editing phase that cost anything. Buckets under 0.05 ms are dropped from the line.
- **`other`** — gesture milliseconds no span accounted for.

**The arithmetic closes:** every printed span plus `other` sums to `gesture`. That is why the meter opens no span of its own — the old note printed a `keystroke=` wrapper span whose exclusive time ran past the last update to the macrotask that closed it, so the numbers added up to nothing in particular and the one wall number was ambiguous between JS work and time to paint.

There is no separate editor surface on `globalThis` — no `__sefer.editor`. The editor reports through this one ring like everything else, so `__sefer.observability.recent()` at level `spans` is how a keystroke is read. The engine's own `analyze` span lands here too, under the Galley adapter. (If an agent ever needs to drive the editor programmatically over CDP rather than by clicking, the thing to expose is the editor view itself, not a second instrument.)

The editor's per-transaction instrument (`src/editor/core/instrument.ts`) writes this ring through `observabilityTracer`, which reads the level ONCE when a trace begins. At `verdicts` it writes one note per transaction, and only when a stage did not pass — the first such stage, which is the one a `Refusal` names; a paragraph of ordinary typing writes nothing. At `spans` and `all` it also writes a span per pipeline frame (`editor.phase.<name>`, `editor.command.<name>`) and a note per frame verdict, in pipeline order, so `recent()` reads as the keystroke's flow through the rules. Every one carries the correlation `<bookId>#<trace seq>`. Derivation spans (`scan`, `index`, `decorate`, `paint`) never cross: they run several times per keystroke and the meter's one note already carries their exclusive totals. See [Editor › Instrumentation](editor.md#instrumentation).

Measured 2026-09-08 on the Psalms fixture in the dev build: `boot` 0 ms (it only validates the host and build), `project.open` ~3 ms for five books, the initial `analyze.project` ~20 ms, warm `analyze` per keystroke ~0.5 ms (7 ms cold), keystroke wall 2–3 ms warm and ~11 ms for the first keystroke after mount.
