# Findings, project analysis, and fixes

Galley produces diagnostics in the same call that produces structure. This is where they go, and what may be done with them. Slices 13–15; the sinks table is [the editor and save seams](../../planning/00-ideas/v2-editor-and-save-seams.md) §2.

## The sinks, as they now exist

| sink | who | when | code |
|---|---|---|---|
| 1 · editor inline | the editor's lint recipe | synchronously, every keystroke, from the current state's analysis | `src/editor` |
| 2 · Findings, per book | `fromAnalysis(bookId, analysis, stamp)` | off the keystroke path for other books; from the editor's own analysis for the instantiated one | `src/core/findings/` |
| 3 · ProjectAnalysis | `census`, `findings`, `crossBook`, `watch` | debounced ~150 ms after a publish; once per project open | `src/core/analysis/` |
| 4 · Observability | `note('analyze', …, 'BOOK diag=N err=E', bookId)` | per analysis | inside ProjectAnalysis and Galley |
| 5 · Fixes | `preview(finding, book, analysis)` | on demand, per finding | `src/core/fixes/` |

Sink 4 carries counts and codes only. A diagnostic's message quotes the document, so it lives in sinks 1, 2 and 5 and never in telemetry.

## The one shape

`Finding { id, bookId, severity, code, producer, message, from, to, stamp, engine, fix? }` — `src/core/findings/finding.ts` is the only place either producer is translated into it.

- `severity` is `error | warning | info`. Onion's `hint` folds into `info`; a code that says nothing at the document's declared `\usfm` version (and the whole `form` category) is **dropped**, so the census counts stay honest.
- Sous carries no severity ladder at all, so Sefer's presentation policy is stated once in `corpusSeverity`: Hygiene is an error (a control character or a conflict marker is a defect in the file), Presence is a warning, everything statistical is info.
- `code` is the catalogue name for Onion (`unknown-marker`) and `sous.<lane>[.<class>]` for Sous (`sous.hygiene.C0Control`, `sous.convention.Rarity`).
- `id` is `producer:bookId:code:from-to`. **Row indices are not durable identities** — the next publication renumbers everything — so identity is semantic, and two rows with the same code at the same span are one finding.
- `from`/`to` are UTF-16 offsets into the text the stamps name, exactly as the engine reported them. Nothing shifts an offset. A Sous publication whose `coordinateSpace` is UTF-8 is dropped whole rather than mixed with UTF-16 findings.
- `fix` is a **pointer** (`{ kind: 'engine', diagnosticIndex }`), not the edits: a panel of four hundred findings resolves none of them.
- `Finding` carries no `Ref`. A chapter:verse address is only derivable from a table of contents, and one from another revision names the wrong verse with total confidence — so `navigateTarget(finding, analysis?)` fills `ref` in only when the caller hands over the analysis the finding was computed from.

## Freshness

Two stamps, two scopes. `stamp` is the Book's `SourceStamp`: within one Book's lifetime the revision decides, and `stale(finding, book)` is the check a panel makes before navigating. `engine` is the `EngineStamp` (the engine's xxh3 hash plus length): it survives across Book lifetimes and is what `Fixes.preview` reads before it will touch text. Length alone never decides.

`ProjectAnalysis.fresh(bookId, stamp)` answers whether the held analysis is the one for that stamp. A book with no analysis reports zero counts in the census — read `fresh` to tell that apart from a clean book.

## What ProjectAnalysis holds

One project's worth of stamped, disposable analyses, plus the last Galley publication. It exists because a translator must not have to open sixty-six files to learn whether the project has errors (vision §11.1), so `attach(project)` analyzes **every** book once at project open and registers each as a corpus target.

- `attach` subscribes to every `book.changes` and to `project.changed` (a seat swap replaces the object holding the canonical text, so the old subscription is dead). A change marks the book stale and arms one scheduling fiber.
- **One fiber, not one per book.** It waits for ~150 ms of quiet (or 1 s from the start of a burst), then re-analyzes every pending book and publishes the corpus **once** — `publish()` is whole-corpus and a snapshot replaces the previous one entirely, so per-book publication would judge the corpus n times for one gesture.
- The instantiated book is never analyzed twice: the editor hands its current parse in through `supply(bookId, analysis)`, which composition wires. The scheduler then owes that book only its corpus registration. A supplied analysis is used only if it still `describesExactly` the Book's text.
- An engine refusal **retains**: the last analysis stays, the entry stays stale, `note('analyze', 'failed', …)` records it. A failed refresh never reports a clean project (vision §11.4).
- `findings()` is memoised until something changes; `crossBook()` is the Sous half alone.

Filtering and grouping are presentation policy. `findings.ts` orders findings by book (project order), then severity, then position; hiding a category is the shell's business and does not alter analysis truth.

Core cannot navigate. `navigateTarget` returns a value; the shell calls `project.instantiate(bookId)`, mounts a view and scrolls the semantic span into place. The span stays exact even when visual mode hides the markup it covers (vision §11.3) — a presentation anchor is the view's decision, never a substitution here, because the same span is what a fix would edit.

## What fixes can and cannot do

Sefer writes no USFM transformations. Onion attaches the edits to the diagnostic that found the problem, and `src/core/fixes/fixes.ts` only carries them to `book.apply(changes, 'fix', trustedBy('fix'))` — the one write path, so Undo, Save, Recovery and the panel all learn about the edit.

- `preview` refuses `Stale` unless the analysis `describesExactly` the Book's current text **and** matches the finding's engine stamp **and** the diagnostic at that index still carries the same code. Three checks because they catch different mistakes; a same-length edit passes a length check alone.
- `apply` refuses `Stale` if the Book's revision moved since the preview. `applyAll(previews, book)` puts one book's set through a single `apply` — one Undo step, one receipt — and one stale or foreign member refuses the whole set rather than applying it partially.
- Whether the edit is admissible at all is the Book's business: an editor-backed Book runs its phases, and a fix that would break structure is refused by the rules, not by a check here.
- `formatBook` **fails** with `Unsupported`. The pinned artifact exposes no `format`/`formatEdits` (see [Galley](galley.md), "What the handle cannot do yet"), and reimplementing the formatter in TypeScript is out of scope. The ask goes upstream to the engine's wasm surface.
- Sous findings never carry edits — they measure. `preview` refuses them `NotEngineFix`.
