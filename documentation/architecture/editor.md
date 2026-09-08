# Editor

**The editor** is `src/editor/`: the CodeMirror area, and the `Book` implementation whose canonical text is a CodeMirror `EditorState`. It was ported property by property from the `onion-2-spike` prototype, which had a large Node and browser test suite behind it — behaviour there is the specification, and a difference from it is a bug here, not a design choice.

Nothing above the editor imports CodeMirror. The editor imports [Galley](galley.md)'s `Analysis` and core's `Book`/`Source` vocabulary, and nothing else from the application. Import from `src/editor` (the barrel).

## The analyzer facet

The spike called a module-level engine singleton. Sefer has none: the engine's lifetime belongs to the `Galley` Layer, and each Book gets its own memo. So the engine reaches a state through a facet — `analyzer`, in `core/analyzer.ts` — and `usfmEditor({ analyze })` / `usfmEditorHeadless({ analyze })` supply it. Composition passes `galley.memoize()`, one per Book, so a keystroke in Philemon does not evict the parse of Jude. `analyze` is **required**: the facet's own `combine` throws if it is missing, because a USFM editor with no engine is a text box wearing our class names.

Everything downstream is a function of that facet rather than of a global: `enginePort(analyze)` supplies the two questions the admission rules ask the engine (`marksUp`, `chapterCount`), and `structureField` reads `state.facet(analyzer)`.

## The editor-backed Book

`editorBook(plain, { analyze, extensions?, observability? })` is the Plain → Instantiated transition ([project](project.md), [source and book](source.md)). The state is created **from** `plain.source().text`, and from that moment the state *is* the canonical text: `source()` derives the string from it, cached per `EditorState`, and the stamp's `revision` continues from the plain Book's and increments once per accepted doc-changing transaction.

`apply(changes, origin, trust?)` builds one transaction — `userEvent: input.<origin>`, `trusted` when the trust says so, `isolateHistory` for a `project.*` origin so a cross-book operation is one undo step per book — and runs it through the phases. Accepted: `Result.succeed(receipt)`. Refused (the doc did not change): `Result.fail(Refusal)`, whose `rule` names the phase rule when one recorded a refusal on the trace and `editor.phases` otherwise.

**The publication rule.** After the state has moved, and synchronously: borrowing surfaces first (`attach(receive)`, given CodeMirror's own `ChangeSet` so a window maps its caret through the exact same description), then the `Book` port's `changes(fn)` listeners with `(receipt, Change[])`. `apply` returns only after every subscriber has run. There is no bus and no queue — the keystroke path is `phases → analyze → mutate → publish` inside one frame.

A bound view MUST route its transactions through `book.fromView(view, trs)`; that is where a keystroke becomes a receipt. `apply` throws if a bound view accepted an edit without it, rather than report a receipt nobody heard.

`seatFor(options)` is the factory `openProject({ seat })` wants. `attached()` counts bound views plus `hold()`s (windows, satellites) and is what makes `project.release` refuse.

## Windows and satellites borrow

`openWindow(book, at, options)` gives a headless state over the whole book, clipped to the chapter containing `at`. `mountSatellite({ host: Funnel, range, … })` gives a view over one range. Both are readers that may write, and both keep the same discipline: a local edit is turned into changes, submitted through the `Funnel` (`funnel.ts` — `doc`, `structure`, `submit`, `attach`, `undo`/`redo`/`depth`), and applied locally only when the canonical Book publishes it back. They keep their own caret across the round trip; they never keep their own text. `fromCanonical` marks the text coming home, so nothing resubmits it.

Structure is **borrowed**, not recomputed: a window's `structureField` asks the `borrowedStructure` facet first and takes the canonical `Analysis` when `describesExactly` holds, so ten result cards over one book cost zero extra parses. The one turn a window pays for a parse of its own is between its submit and the answer.

## The phases

`admission → normalization → protection → settlement`, listed as data in `core/phases.ts`. Admission runs as a `changeFilter` (it can veto ranges before a transaction exists); the rest run as `transactionFilter`s, which CodeMirror runs last-registered-first — `compose.install` is the only place that knows, and it reverses so registration order is the order rules see. Every rule is named, so `omit` can turn one off and a trace can say which door a keystroke went through.

## Diagnostics, sink 1

`recipes/lint.ts` turns `structureAt(state).analysis.diagnostics` into inline marks and gutter fix actions. Rebuilt from the current state every keystroke, so an inline mark cannot be stale. A finding whose whole span is inside hidden markup is dropped by default — that test reads the **paint index** (`PAINT_PORT.hidden`), not the decoration set. A fix carries the analysis's `EngineStamp` and is discarded if the document moved under it.

## Instruments

The editor keeps its own: `core/timing.ts` (a local span ring, inert until something listens), `core/trace.ts` (per-rule verdicts through a facet sink), `core/meter.ts` (wall time from DOM event to the last update of a gesture). They are not Effect — they run inside change and transaction filters thousands of times per typed paragraph. `src/editor/observability.ts` is the one bridge: `observabilitySink(observability)` forwards rule **decisions** to `observability.note`. Spans are not forwarded, and `passed` is dropped: the phase installer notes every rule it enters, and forwarding those would evict everything else from a 2000-entry ring.

## What was not ported

- **`attrs`/`attrResolve`** — the aligned-word popover (`recipes/attrs.ts`) needs two engine free functions the pinned wasm handle does not export. Both call sites throw with a `TODO(seam)`, deliberately: a popover that silently shows no attributes reads as "this word has none", and a wrong answer about alignment is worse than a visible defect.
- **`formatEdits` / `format` / `locate`** — the engine's normalisation, likewise not on the handle. Nothing in `src/editor` references them; formatting is [Fixes](../../planning/00-ideas/v2-module-seams.md)' seam when the handle grows them.
- **`startEngine` / `runAnalyze`** — replaced by the `Galley` Layer and the analyzer facet.

## The file map, by responsibility

| what | where |
|---|---|
| the engine seam | `core/analyzer.ts` |
| the fold (structure) | `core/docStructure.ts`, `cst.ts`, `fold.ts`, `lineTable.ts`, `blockTable.ts`, `notes.ts`, `designators.ts` |
| classification, then policy | `core/mapping.ts` → `core/registry.ts` |
| the plan, owned targets, paint, stops | `core/plan.ts`, `owned.ts`, `paint.ts`, `stops.ts`, `exceptions.ts` |
| rules and commands | `core/phases.ts`, `compose.ts`, `sealed.ts`, `clip.ts`, `input.ts`, `deletion.ts`, `caret.ts`, `kernel.ts` |
| rendering | `core/decorations.ts`, `render.ts`, `editorState.ts`, `editor.css` |
| instruments | `core/meter.ts`, `timing.ts`, `trace.ts`, `inspect.ts`, `../observability.ts` |
| the Book, the funnel, windows, views | `book.ts`, `funnel.ts`, `window.ts`, `views.ts` |
| recipes over the editor | `recipes/lint.ts`, `copy.ts`, `satellite.ts`, `attrs.ts` |
| test tools (not tests) | `testing/harness.ts`, `testing/mount.ts` |
