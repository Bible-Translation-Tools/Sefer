# Local observability and agent evidence

- **Status:** provisional idea; not an adopted architecture or implementation authorization
- **Scope:** application telemetry, editor decision evidence, local development inspection, and opt-in field diagnostics
- **Working guide:** [`documentation/architecture/observability.md`](../../documentation/architecture/observability.md)

## Motivation

Tests verify selected behavior repeatedly. Interactive verification asks what a particular application instance did while a human or agent exercised a real user path. Sefer should make that answer cheap without a hosted telemetry service or manuscript content in logs.

CodeMirror owns the canonical whole-book document, and Galley is intended to complete within the same interaction frame while measurement permits. File loading, backup, autosave, and other host operations may be asynchronous, but completion must remain correlated to the captured document revision. Observability must not block editing, introduce IPC per keystroke, or become another document authority.

## Preferred boundary

Effect Logger and `tauri-plugin-log` would be duplicative if application code called both. The proposed boundary uses **one application logging API with multiple platform sinks**:

- TypeScript application code logs and traces through Effect.
- Effect owns structured records, levels, annotations, span/operation correlation, and exporter lifecycle.
- The synchronous editor path writes compact decision events to a direct bounded sink.
- On desktop, `tauri-plugin-log` is a candidate native persistence adapter and Rust-log bridge behind that sink.
- Web development uses console and bounded memory.
- Motel is an optional local OTLP viewer/query store.
- JSONL is the portable field-support and agent-evidence format.

No feature should import and call Effect Logger and the Tauri logger in parallel. If the Tauri plugin cannot preserve structured JSONL, bound retention, or avoid harmful hot-path latency, use a small native JSONL writer without changing the application-facing contract.

## Synchronous editor and Galley path

Keep CodeMirror policy, canonical transaction application, and synchronous Galley analysis as ordinary synchronous work. Do not create a Promise, Effect fiber, filesystem write, IPC call, or exporter action for each rule decision.

A meaningful input/transaction operation may have a short span. Policy decisions remain events associated with it: stable rule/event name, verdict and reason code, document revision, operation ID, and safe numeric metadata. Refused or consumed inputs must be observable even when no transaction is dispatched. A span measures duration and outcome; events explain why the editor acted.

The bounded sink write must be non-throwing and constant-time in ordinary operation. Under pressure it may drop according to a documented policy and increment a dropped-record counter. Export drains later in batches. Telemetry failure never changes editor behavior.

Do not treat `.pipe()` itself as tracing. Use Effect spans where a meaningful application operation has a lifetime; keep pure synchronous policy functions plain.

## Asynchronous host work

Loading and host I/O may run through Effect services and platform adapters. Backup/autosave may run asynchronously, but it is not correctness-free fire-and-forget: its completion or failure must be observable and bound to the captured revision. Explicit save needs a matching receipt before saved/recovery baselines change.

Pass operation ID, captured revision, and optional verification run ID across Tauri IPC. Promote full trace-context propagation only if measured Rust child spans add diagnostic value.

## Queryability without a session protocol

Do not start with Begin/Mark/Inspect/End APIs. JSONL is directly queryable; Motel makes OTLP queryable; a bounded sink can expose recent records.

Initial agent access consists of:

- an optional run ID assigned automatically when an isolated verification instance launches;
- stable structured fields inherited by every record;
- a development-only read-only recent-N view;
- direct JSONL filtering on desktop;
- an ordinary `verification.step` event only when a step marker is useful;
- a bounded flush for controlled shutdown or evidence export.

The harness filters or copies records by run ID into its evidence directory. Add a formal capture-session API only after a concrete workflow cannot be served this way.

## Volume control

Use one ordered runtime level in development and production:

- `off`: no application telemetry;
- `error`: unexpected failures and unrecoverable states;
- `info`: lifecycle and major-operation outcomes;
- `debug`: revision transitions, scheduling, analysis timing, and summarized editor outcomes;
- `trace`: individual editor decisions and detailed safe transaction/selection metadata.

Proposed defaults: `debug` in development, `trace` for isolated verification, and `info` in production. A user may temporarily enable detailed field diagnostics; the override should revert on restart unless evidence supports persistence.

Levels govern payload as well as volume. Never record manuscript text, clipboard/search contents, tokens, full paths, or arbitrary serialized objects.

## Desktop persistence and retention

Proposed format is one JSON object per line with UTC time, monotonic sequence, level, event, build/instance identity, optional run/operation/trace/span IDs, relevant document revision, outcome, and safe attributes.

Retention values require measurement. A probe can start at 5 MiB per file, at most four files including the active file, and seven days. Bound file count/size, age, pending queue, and individual record size; expose truncation and dropped counts.

`tauri-plugin-log` currently supports frontend and Rust logging, platform log directories, filtering, custom formatting, maximum size, and rotation. Its documented `KeepAll` mode is not Sefer's bounded-count policy, so current behavior requires proof. Evidence copied into a verification report must survive ordinary rotation. Telemetry is neither recovery nor manuscript history.

## Optional tools

Motel is promising for development-only OTLP ingest, SQLite storage, terminal/web inspection, and agent queries. Sefer must start and verify without Motel, Bun, Docker, or a cloud account.

Defer rrweb. It creates a distinct, sensitive DOM/session stream. Start with screenshots, browser traces, application events, and persisted-side-effect checks. Reconsider only for a demonstrated diagnostic gap after manuscript masking is proven.

Do not deploy LGTM or another hosted backend as part of this idea. OTLP compatibility preserves the option.

## First probe

Use one real edit-to-save vertical slice:

1. Launch an isolated instance with an automatic run ID.
2. Record accepted and refused decisions through the bounded sink.
3. Run synchronous Galley work under the same operation correlation within the frame.
4. Save a captured revision through the actual platform adapter.
5. Record its receipt while a newer edit exists.
6. Query recent memory and desktop JSONL, then optionally inspect OTLP in Motel.

Measure ordinary and large-book cost with telemetry off, at production level, and at trace level. Force buffer overflow, a missing exporter, oversized attributes, disk/write failure where practical, and shutdown during flush. Pass only if behavior is unchanged and evidence reports loss explicitly.

## Open questions and gates

### Effect and application

- Which exact Effect v4 release and observability APIs should be pinned?
- What span granularity stays within the synchronous editor/Galley frame budget?
- Should the stable application event schema adapt into Effect/OTLP, or should editor decisions be native span events?
- What minimum Effect service boundary supports Web/Tauri composition without wrapping pure policy?

### Tauri and Rust

- Can `tauri-plugin-log` preserve one JSON object per line without prefixes, escaping loss, or double serialization?
- Can frontend Effect and Rust records share a schema/destination while retaining useful Rust targets?
- Can current rotation enforce file count plus age across macOS, Windows, and Linux, or is startup cleanup needed?
- Does frontend plugin logging cross IPC per record? Where must batching occur?
- Can agents locate/read the active file without broad filesystem permissions?
- Is operation ID plus revision sufficient across IPC, or does one tested path justify trace-context propagation?

### Data safety

- Which identifiers help diagnosis without exposing project or scripture content?
- What error representation prevents accidental payload serialization?
- Which fields are allowed at each level, and how is that reviewed as events are added?
- What export preview and product wording are required before a user shares a bundle?

### Verification

- Is a development-only recent-N hook enough for browser agents, or does a real workflow justify a local endpoint?
- How is a run ID injected consistently into Web, Tauri, Playwright, and WebdriverIO?
- What constitutes complete evidence: screenshot, filtered JSONL, trace, revision summary, dropped count, and persisted-byte check?
- When should an exploratory finding become a deterministic test, and at which owning seam?

### Retention and failure

- What do representative `info`, `debug`, and `trace` sessions cost in bytes and writes?
- Are the provisional size/count/age limits sensible after measurement?
- What happens when logger initialization, rotation, cleanup, or flush fails?
- Should Web production persist anything before explicit diagnostic export?

## First-slice non-goals

- PubSub or a general event bus;
- hosted telemetry or production phone-home;
- full replay or event sourcing;
- rrweb integration;
- required Motel installation;
- telemetry authority over source, recovery, or saves;
- manuscript logging;
- Effect wrappers around every pure function;
- lossless telemetry during crashes or overflow.

## References

- [Effect tracing](https://effect.website/docs/v4/observability/tracing)
- [Motel](https://github.com/kitlangton/motel)
- [Tauri logging](https://v2.tauri.app/plugin/logging/)
- [rrweb](https://github.com/rrweb-io/rrweb)
