# Observability shorthand

Sefer records what it did into one bounded, in-process ring, writes every event to a bounded log directory on the device, and hands it over only when a person exports it — no hosted telemetry service, nothing sent anywhere unasked, and no manuscript content. The event vocabulary is in the [glossary](../glossary.md), "Observability names".

## Principles

- **The hot path never waits on telemetry.** A write into the ring is synchronous, constant-time and non-throwing. No Promise, fiber, filesystem write, IPC call or exporter action is created per editor decision.
- **Loss is counted, never hidden.** A sink that throws is dropped and counted (`dropped()`); telemetry never changes domain or editor behaviour.
- **No capture-session API.** There is no Begin/Mark/Inspect/End protocol. The ring is queryable in place, `export()` is JSONL for `jq`/`rg`, and an OTLP collector is optional. Add an API only when a real workflow cannot be served this way.
- **A run is identifiable.** `session()` stamps every event of one run with its id, build and host; `pnpm verify:launch` gives each isolated instance its own run directory.
- **One application API.** Code narrates through the `Observability` service. A platform logger — the console, `tauri-plugin-log` — is a sink behind it, never a second API called in parallel.
- **Never record** manuscript text, clipboard or search contents, tokens, account names, or arbitrary objects. A local path may be recorded — the ring and the log files stay on the device, like the projects — and export is where paths are cut to their last segment (see [Disk and export](#disk-and-export)).
- **`failed` is the one alarm.** A verdict is an outcome, not a severity. `failed` means our code or an invariant broke, and a dev build prints every one as a `console.error`, unasked. `unavailable` means the world said no — offline, a server down, a host without the capability — and is set only at the outside boundaries (the Remote port, the catalogue, the language API, the updater, `fetch`); anything uncaught elsewhere stays `failed`. `refused` and `declined` are usually the app working. There is no severity ladder.

## The service

`src/core/observability.ts` defines the `Observability` service (an Effect 4 `Context.Service`):

- `operation(name, attrs?, options?) => Operation` — opens ONE end-to-end piece of work, which in practice is one thing the user did. The returned `Operation` IS an `ObservabilityService`, plus `attr(attrs)`, `end(verdict?, attrs?)`, and its own `trace` and `id`.
- `span(name, note?, attrs?) => (attrs?) => number` — synchronous and nestable. The returned closer records inclusive `ms` and exclusive `self` (inclusive minus the time billed to spans opened and closed inside it) and returns the inclusive milliseconds. Below level `spans` it is two `performance.now()` reads and records nothing.
- `note(rule, verdict, detail?, attrs?)` — synchronous. `verdict` is the closed union `ready | passed | refused | rewrote | consumed | declined | unavailable | failed`.
- `session()` — the id, build and host every event of this run has in common.
- `recent(limit?)` — the newest events, oldest first.
- `failures(limit?)` — the newest events whose verdict is `failed`, `unavailable` or `refused` (`HELD_VERDICTS`), oldest first, from a second ring of 200 kept at recording time, so ordinary work wrapping the main ring cannot evict one.
- `export()` — JSONL, one event per line, each line terminated by a newline.
- `level()` / `setLevel(level)`.
- `dropped()` — how many events the sink refused, by throwing.

A sink is `(event) => void` and sees the event object only: a sink that wants the JSONL line calls `eventLine(event)` itself, later and in a batch, rather than the ring serialising every event for sinks that never read the text.

The recording level is `off | verdicts | spans | all` — see [Levels](#levels).

Storage is one fixed ring buffer, default 2 000 events, size set by the Layer's `capacity` option. The oldest event is overwritten; nothing grows.

A sink is host code and may do anything, including throw. `push` calls it inside a `try`/`catch`: a throwing sink increments `dropped()` and is never rethrown, so `note()` and a span's closer return normally and the event is still in the ring. Telemetry is dropped under pressure and counted; it never changes domain behaviour.

`name` and `detail` are truncated to `MAX_TEXT` (512) characters before the event is recorded, so one runaway string cannot bloat the ring or a sink line. The cap is applied on the way in, so `recent()` and `export()` agree.

Recorded event fields, in the order `export()` writes them: `seq`, `t` (epoch milliseconds), `kind` (`operation | span | note | log`), `name`, `verdict`, `detail`, `ms`, `self`, `trace`, `id`, `parent`, `attrs`. Absent fields are omitted from the line.

`attrs` is the wide half: `Record<string, string | number | boolean>`, capped at `MAX_ATTRS` (32) keys with string values through `MAX_TEXT`. Primitives only, and the type is the enforcement — an attribute holding a reference would be pinned alive by the ring for the next `capacity` events, which is how a bounded buffer becomes a leak. Prefer fields over sentences: `{ "book.id": id, "book.revision": 41 }` is queryable where `` `${id} r41` `` is not.

## How an operation propagates

`trace` is the OPERATION — one gesture — not a book and not a file; those are attributes OF the work. Every event carries the `trace` it belongs to and the `parent` span it happened inside, so a gesture reassembles into a tree.

Propagation is dependency injection, not ambient state and not a parameter threaded through core. An `Operation` is an `ObservabilityService`, so the gesture's door provides it — `Effect.provideService(Observability, operation)` — and core's existing `Effect.serviceOption(Observability)` receives it without knowing whether it is the root or a gesture's own. Correct across every await, because Effect's context lives on the fiber. **Core narrates; it does not know anyone is tracing.** No core module imports a span, a trace, or an exporter.

The editor is the exception, and deliberately so: its rules run inside `changeFilter` and `transactionFilter` on the keystroke path, where there is no fiber to carry a context. `observabilityTracer` in `src/editor/observability.ts`, wired in `src/editor/book.ts`, opens one operation per transaction — `editor.mutation` when it changed the text, `editor.selection` when it only moved the caret, and `editor.render` for a repaint nobody typed for — and passes it down its own instrument.

Work that no gesture caused — a filesystem watcher — carries no `trace` and exports as a root of its own. That is the honest shape, and it makes "which traces had no gesture behind them" a query.

`ObservabilityLive(options)` in core builds the ring and merges three layers: the service itself, `Logger.layer` with a logger that writes every `Effect.log*` into the ring as a `log` event (`name` is the message, `detail` is the Effect log level, `verdict` is `failed` for `Error` and `Fatal`), and `Tracer.Tracer` replaced by a tracer that wraps `Tracer.NativeSpan` and records each span as it ends, under its own `traceId` and `spanId`. Because the logger layer replaces the default, `Effect.log*` no longer writes to the console on its own.

Sinks are the host's job, in `src/platform/observability.ts`. `hostSink()` returns a stderr writer that emits each JSONL line when `SEFER_LOG` or `VITE_SEFER_LOG` is set under a Node-shaped host, and `undefined` otherwise. The composition also feeds the ring's events through core's `makeAssembler`, which reassembles each operation into a tree and fans it out to the dev rings, the console stream and the OTLP bridge. The console stream (`consoleStream()`) prints operations as they finish, drained on idle; it is off unless `VITE_SEFER_STREAM` asks for it (`1`, or comma-separated name prefixes, `!` to exclude) or `stream({ enabled: true, filters? })` turns it on at runtime. Independently of the stream, a dev build prints every `failed` — an operation carrying one anywhere inside it, or a loose event — as a `console.error`, through the same idle drain; `stream({ enabled, alarms: false })` silences it for a session failing on purpose. The stream also filters by outcome: `stream({ enabled: true, verdicts: ["failed", "unavailable"] })`, or `@failed,@unavailable` in `VITE_SEFER_STREAM`. Under the dev server, `installObservabilityDevSurface` publishes `globalThis.__sefer.observability = { traces: { recent, print }, logs: { recent }, errors, failures, export, level, setLevel, stream }`, and nothing in any other build. `errors()` is the `failed` half of the failure ring; `failures()` is all of it. Core references neither `console` nor `globalThis`.

Client failures are recorded in every build, as one `client.error` note with verdict `failed`, `error.type` naming the class, and `error.handling` saying which door heard it (`src/app/clientErrors.ts`). `boundary` means Solid's `configureClientErrors` hook: an error boundary caught the error and rendered its fallback, which nothing else sees. `uncaught` is the browser's `error` event, including a halted reactive graph. `rejection` is `unhandledrejection`. One `error` event is not recorded: the browser's `ResizeObserver loop completed with undelivered notifications`, which carries no `error` object — an observer callback resized something and delivery slipped a frame (the virtualizer and floating-ui both do it), and nothing threw. The detail is `describe(error)`; `error.owner` and `error.boundary` carry Solid's owner paths where the runtime keeps owner names. `errors()` lists them, with every other `failed`. `no-console` is a lint error in `src/` outside the console renderer (`src/platform/observability.ts`) and tests, so nothing prints around the ring; the editor's own fallbacks (`stateFailed`, a lint fix discarded because the text moved) report through `reportOutcome` in `src/editor/core/instrument.ts`, which the ring bridge registers.

`src/app/composition.ts` builds the Layer at the root and runs `boot` inside `root.operation("boot")`, which ends `ready` (with host, build and boot phase) or `failed` (with the error tag).

`composeApplication(options)` is the one composition entry: it builds the Layer into a `ManagedRuntime`, runs `boot` on it, and returns `{ boot, observability, fileSystem, layer, runtime, dispose }` — see [composition](composition.md) for why the runtime, not the program, owns the Layer's scope. `src/App.tsx` awaits it once with no options — the domain `FileSystem` arrives with `composeServices` ([shell](shell.md)) — and hands the result to every consumer through `useComposition()`. There is one ring per running application: the dev fixture route merges its seeded FileSystem over `composition.layer` instead of composing again, so its `fixture` note lands in the same ring beside the `boot` note.

OTLP is a dev-only toggle in `composeApplication`, and it is a SINK ON THE RING rather than a second Layer. The exporters only ever see Effect-native spans and logs, and `Effect.log`/`Effect.withSpan` appear nowhere in `src/` except inside this bridge — the ring's `note()` and `span()` are plain function calls — so merging `Otlp.layerJson` beside `ObservabilityLive` exported nothing at all, and the two layers fought over the same `Tracer` and `CurrentLoggers`. Instead, when `import.meta.env.DEV` and `VITE_SEFER_OTLP_URL` is set, `telemetryBridge()` dynamically imports `OtlpTracer`, `OtlpLogger`, `OtlpMetrics`, `OtlpSerialization` and `FetchHttpClient`, builds a `ManagedRuntime` of its OWN from them, and returns a sink: every ring event is forwarded, a `note` or `log` as an OTLP log record and a `span` as a real span carrying the duration the ring measured. The ring keeps its own tracer and logger untouched, and there is no loop, because that runtime's logger set is the OTLP one alone.

The browser posts to the SAME-ORIGIN path `/__otlp`, which the dev server proxies to the collector. A collector is a different origin and an OTLP body is `application/json`, so a direct post is preflighted — and motel answers `OPTIONS /v1/logs` with a bare 404, so the preflight fails and the POST is never made, silently. `OTLP_PROXY_PATH` is declared in both `vite.config.ts` and `src/app/composition.ts`, beside the same explanation. Metrics stay opt-in behind `VITE_SEFER_OTLP_METRICS=1`, because motel serves `/v1/traces` and `/v1/logs` and answers `/v1/metrics` with nothing; each signal gets its own `guardedFetch`, which warns once and then refuses locally rather than filling the console with `net::ERR_FAILED` on every interval. Run it with

```sh
VITE_SEFER_OTLP_URL=http://127.0.0.1:27686 pnpm dev
```

and read it in motel on that same port — `motel tui`, or `http://127.0.0.1:27686/api/traces`. In the TUI, `[` and `]` cycle the service: it remembers the last one in `~/.local/state/motel/last-service.txt` and otherwise defaults to its own `motel-otel-tui`, which shows an empty trace list while Sefer is exporting perfectly well under `sefer`. The imports are dynamic and inside the `import.meta.env.DEV` branch, so a production build contains no OTLP code: `grep -r Otlp dist/` comes back empty. Note that the OTLP Layer builds asynchronously, which is why the composition is a `Promise` and `src/App.tsx` uses top-level `await`.

The bridge holds a gesture's events until its operation record arrives, because the ring writes the wide record LAST — everything known by the time the work finished — and an exporter needs the parent first. The hold is core's `makeAssembler`, bounded at 64 traces and 256 events each, oldest dropped: an operation that never ends must not grow it. Children are emitted inside the parent span's context, so the OTLP logger stamps each note with the trace and span it belongs to.

Not present yet: cross-process correlation with the Tauri host — a Rust `invoke` is one opaque child span, timed from the web side, which is the same shape Effect gives an async filesystem call.

## Disk and export

**Every recorded event is written to disk.** The ring's 2,000 events are the MEMORY bound — enough for the dev surface, small enough not to pressure a Web heap — and the log directory is what is kept, so nothing is lost when the ring wraps or the app restarts. `src/core/diagnostics/logFiles.ts` is the mechanism and `src/app/diagnostics.ts` wires it:

- **From boot, a queue.** `composeApplication` puts `makeLogQueue().sink` beside the other sinks: one array push per event, nothing serialised. It holds up to 5,000 events; when full the OLDEST are dropped and counted, and the count is written as `{"kind":"dropped","t","count"}`. Recording never waits on disk.
- **Once the services exist, a writer.** `composeServices` calls `startLogFiles`, because that is when there is a FileSystem. It drains the queue when the browser is idle, at most every 2 s, and at once on `visibilitychange` to hidden and on `pagehide`: one serialise-and-append per batch, chained, never concurrent. The first write that fails stops the writer for the session and says so once, as `diagnostics.persist` `unavailable`.
- **Where:** `HostInfo.paths().logs` — `/sefer/logs` in OPFS on the Web, the OS app log directory on desktop (`$APPLOG` is in the Tauri fs scope). The seeded fixture writes nothing: its FileSystem is memory.
- **Shape:** one session is a run of parts, `<UTC stamp>-<session id>-<part>.jsonl`, each at most 256 KB (appending to OPFS rewrites the file, so parts stay small) and each opening with the session header, so any one file read alone says what wrote it.
- **Retention:** at start, parts older than seven days are deleted, then whole sessions oldest-first until the directory is under 5 MB. The session being written is never deleted. `LOG_LIMITS` holds the numbers.

**The session header** (`src/core/diagnostics/header.ts`, `schema: 1`, `kind: "sefer.session"`): session id and start, `build` (`<sha>+<mode>`), `channel`, the engine tag, `host`, `os`, `osVersion`, `arch`, `webview`, `userAgent`, `locale`, the desktop app `version`, and the endpoints with whether a preference moved them — the `VITE_SEFER_*` URLs ship in the public bundle and are not secret. A fact the host cannot answer is `"unknown"`, never a guess; a browser freezes the OS version in its user agent, so the Web reports none.

**Export** is Settings → Advanced → Export diagnostics (`exportDiagnostics`): a named file on desktop, a download on the Web, and one `diagnostics.export` operation recording its size. The file (`src/core/diagnostics/export.ts`) is JSONL:

1. the header, with `kind: "sefer.export"`, when it was exported, both rings' sizes and oldest times, `dropped`, and a **project snapshot** from local reads only — folder name, HEAD, branch, whether an origin exists, unsaved books, whether a journal is pending, and the last sync state the app OBSERVED (the newest `sync.survey` operation, with its time; never a fetch — an export must not wait on the network)
2. `{"kind":"section","name":"failures"}` and the failure ring
3. `{"kind":"section","name":"recent"}` and the main ring
4. `{"kind":"section","name":"disk"}` and every part on disk, this session's included, flushed first

Recording keeps everything; **export decides disclosure, once, by allowlist.** A string attribute passes only under a key in `STRING_KEYS`, and is scrubbed even then; under any other key it is written as `"redacted"` — present, so the gap is visible and someone lists the key. Numbers and booleans pass. `*.root` and `*.path` keep their last segment. Free text — `detail`, and a log's message — loses home directories, URL credentials and query strings, and e-mail addresses, and is cut to 200 characters. Adding a key to `STRING_KEYS` is the review question: can this string ever carry a person's data?

## Reading it with `jq`

The ring, a log part and an export are the same lines, so one set of filters reads all three. Get lines from a running dev build with `__sefer.observability.export()` (a Playwright script can write it into `.verify/<runId>/`), from desktop's log directory directly, or from an exported file. Add a recipe when the same question has been asked of traces twice.

```sh
# failures, newest last
jq -c 'select(.verdict=="failed" or .verdict=="unavailable")' sefer.jsonl
# operations over a budget (ms)
jq -c 'select(.kind=="operation" and .ms > 50) | {name, ms, verdict}' sefer.jsonl
# one operation and everything inside it: pick its trace id first
jq -c --arg t "$TRACE" 'select(.trace==$t)' sefer.jsonl
# the ten seconds before an event (epoch ms in $T)
jq -c --argjson T "$T" 'select(.t >= $T-10000 and .t <= $T)' sefer.jsonl
# the keystroke tail: each mutation's time to paint (JS work is editor.js_ms), sorted
jq -r 'select(.name=="editor.mutation") | .attrs["editor.to_paint_ms"] // empty' sefer.jsonl | sort -n
# per-operation count and mean ms, to compare two captures side by side
jq -s 'map(select(.kind=="operation")) | group_by(.name) | map({name: .[0].name, n: length, mean: (map(.ms) | add / length)})' sefer.jsonl
```

## Operations

An operation is one end-to-end piece of work — one thing a person did, or one piece of background work no gesture caused — written once, when it finishes, carrying everything known by then. Inside it a **span** is a hop that crosses a boundary and can vary or fail on its own; a **note** is a decision or a refusal; everything else is a field. Work that merely followed — anything debounced — is its own operation, never a child. `OperationName` in `src/core/observability.ts` is the closed list.

| Operation                                                | Opened by                                                         | Carries                                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `boot`                                                   | the application starting                                          | `session.id`, `build.id`, `app.host`, `boot.phase`                                    |
| `project.open`                                           | opening a Project                                                 | `project.root`, `project.books`; metadata, Seats and Baselines inside it              |
| `save`                                                   | Save                                                              | `book.id`, `fs.path`, `fs.bytes`, `book.revision`; `file.write` inside it             |
| `analysis.pass`                                          | the gestures that armed it                                        | `analysis.books`, `analysis.refreshed`; `galley.parse` and `corpus.publish` inside it |
| `editor.mutation` / `editor.selection` / `editor.render` | a transaction that changed the text / moved the caret / a repaint | book, revisions, phase timings, derive totals, meter                                  |
| `command.<id>`                                           | one command, from the palette, a keybinding or a click            | the command id in the name                                                            |
| `import.resource` / `import.remote`                      | importing a picked folder or ZIP / cloning a shared project       | stage timings, counts, outcome and failing phase; no URL or name                      |
| `find.run`                                               | a valid search                                                    | scope, options, scan time, hit count or refusal; never the query text                 |
| `sync.transfer`                                          | the transfer action                                               | action, time, outcome                                                                 |
| `review.apply`                                           | applying a review plan                                            | requested/written counts, target side, refusal                                        |
| `journal.offer` / `journal.restore` / `journal.discard`  | the recovery check on open / the banner's answer                  | candidate, offered, completed and refused counts                                      |

Inside those, as spans: `galley.parse` (with `galley.why` naming its caller), `file.write`, `corpus.publish`. As notes: `book.analyze`, `corpus.update`, `corpus.reference`, `baseline.adopt`, `seat.open`, `seat.close`, `project.metadata`, `book.apply` (only when no gesture is open), `journal.*`, `conflict.resolve`, `library.*`.

## Levels

There are two separate axes, and they must not be confused.

**What the ring records** — and therefore what reaches disk — is `level()` / `setLevel(level)`, one of `off | verdicts | spans | all`: `off` records nothing; `verdicts` records notes and Effect `Logger` output; `spans` adds the synchronous `span` events and the editor's per-frame spans; `all` adds spans created by `Effect.withSpan`. The default is `all` in every build. Whether production should default lower is an open question.

**What reaches a console or a log stream** is decided separately, by the sinks: the stderr JSONL sink under Node (`SEFER_LOG` / `VITE_SEFER_LOG`) and the console stream's name-prefix filters (`VITE_SEFER_STREAM`, or `stream()` at runtime). Printing less never changes what the ring keeps, so turning a stream off never loses evidence. There is no severity ladder (`error`/`info`/`debug`/`trace`), by decision: the verdict is the outcome, `failed` is the alarm, and the operation and span hierarchy is the depth.

## The keystroke meter

When a book is mounted, the editor's `keystrokeMeter` closes one gesture per DOM event and writes one bounded note per gesture, correlated by book id:

```text
keystroke · ready · gesture=4.6ms render=21.3ms analyzes=1 analyze=2.1 decorate=1.0 scan=0.7 paint=0.3 phase:admission=0.1 other=0.4
```

Read it left to right:

- **`gesture`** — the JS work: the DOM event to the LAST state update of the gesture. This is the part Sefer's own code owns.
- **`render`** — the same event to after the browser painted. The Event Timing API answers it where the browser offers one, and the line then prints it as **`input=`**; otherwise it is measured by waiting a frame and then a macrotask inside it (a `requestAnimationFrame` callback runs _before_ the paint) and prints as `render=`. Omitted entirely when neither observed anything — a headless state, a background tab — rather than printed as a guess. It is always larger than `gesture` and it is not a sum: between the last update and the paint sit CodeMirror's measure pass, style and layout.
- **`analyzes`** — parses the gesture actually caused, counted by `Analysis.revision` moving, so a memo hit is not counted.
- **the per-span totals** — exclusive milliseconds per span inside the gesture, biggest first: `analyze` (the engine parse, timed in `core/analyzer.ts`), the derivation spans `scan`, `index`, `decorate`, `paint`, and one `phase:<name>` per editing phase that cost anything. Buckets under 0.05 ms are dropped from the line.
- **`other`** — gesture milliseconds no span accounted for.

**The arithmetic closes:** every printed span plus `other` sums to `gesture`. That is why the meter opens no span of its own — the old note printed a `keystroke=` wrapper span whose exclusive time ran past the last update to the macrotask that closed it, so the numbers added up to nothing in particular and the one wall number was ambiguous between JS work and time to paint.

There is no separate editor surface on `globalThis` — no `__sefer.editor`. The editor reports through this one ring like everything else, so `__sefer.observability.traces.recent()` at level `spans` is how a keystroke is read. The engine's own `analyze` span lands here too, under the Galley adapter. (If an agent ever needs to drive the editor programmatically over CDP rather than by clicking, the thing to expose is the editor view itself, not a second instrument.)

The editor's per-transaction instrument (`src/editor/core/instrument.ts`) writes this ring through `observabilityTracer`, which reads the level ONCE when a trace begins. At `verdicts` it writes one note per transaction, and only when a stage did not pass — the first such stage, which is the one a `Refusal` names; a paragraph of ordinary typing writes nothing. At `spans` and `all` it also writes a span per pipeline frame (`editor.phase.<name>`, `editor.command.<name>`) and a note per frame verdict, in pipeline order, so the ring reads as the keystroke's flow through the rules. Every one carries the correlation `<bookId>#<trace seq>`. Derivation spans (`scan`, `index`, `decorate`, `paint`) never cross: they run several times per keystroke and the meter's one note already carries their exclusive totals. See [Editor › Instrumentation](editor.md#instrumentation).
