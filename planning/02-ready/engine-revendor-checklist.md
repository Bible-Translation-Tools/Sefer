# Re-vendor galley to the next scripture-kitchen tag — checklist

Will built the next engine on 2026-09-15 (both committed packages byte-identical, 1,028,904 bytes, sha dc076233…). Sefer is pinned at `f3a2b0b`. When the tag is pushed, one round does all of this in one commit series; nothing here is started yet.

## Breaking, must change in Sefer

- `Knobs` → `SousSettings`. `config()`/`setConfig()` unchanged; new fields `source_copy`, `source_copy_min_run`, `presence`. Update `src/core/galley` types and any settings plumbing.
- Handle door renames: `parse(text)` → `parseText`, `verseText(text)` → `verseTextOf`, `structureText(text)` → `structureTextOf`. The new by-id doors (`parse(id, diagnostics, toc, utf16)`, `lint(id…)`) answer off retained text and error on a Reference without text.
- **Find wire buffer** now leads with magic `0x444E4946` ("FIND") and a version word, then bookCount. `src/core/galley` find decoder must skip both and refuse a mismatch (this closes engine-asks 5).
- `find(id, …)` no longer errors on a Reference; it searches any book that retains text, erroring only when none was kept.
- Package shape: root `@wycliffeassociates/scripture-kitchen` — `.`/`./web` are galley's build (superset); onion-wasm at `./onion`, `./onion/web`; `./reader` (onion), `./sous-reader` (sous), `./schema`, `./diagnostics.json`. Inner `usfm-galley`: `.`, `./web`, `./web/wasm`, `./sous-reader`. Update `vendor/galley/` layout, `manifest.json`, `accepts(manifest)`, the Cargo pin, and the release workflow's checkout step.

## New doors Sefer wants, and where they land

| door | Sefer consumer |
|---|---|
| module `format`, `formatEdits`, `formatEditsIn`, `FormatOpts`, `Edits` | `Fixes.formatBook` (replace `FORMAT_DOOR` refusal) → `format.book` / `format.project` |
| module `diff`, `merge`, `mergeSplices`, `Splices` | `Galley.diff`/`Galley.merge` door (review round builds it against module exports; offsets bytes unless `utf16=true`) → `/review` decision units |
| module `toByte`, `toUtf16`, `locate` | offset conversions for the above |
| module `attrs`, `trResolve`, `book`, `parse`, `mask` | attrs popover / excerpts may simplify |
| handle `updateReference(id, text, keepText=true)` | Library-bound source/reference resources register with text so they can be searched and overlaid |
| handle `findAll(needle, caseSensitive, wholeWord, limit, scope)` scope `targets`/`references`/`all` | Find gets a scope control "This book · Whole project · Reference" (closes engine-asks 3b) |
| handle `skeleton(id, opts, utf16?)`, `overlay(targetId, sourceId, opts)` → `OverlayEdits { spans, lens, text, overlayText, overlayReport, targetNodeFor, sourceNodeFor }` | **Match formatting** (`src/app/workflows/stet.ts` `matchFormatting` stub) — source text with the equivalent block highlighted (closes engine-asks 3) |
| handle `fingerprint(text)` → `differsFrom`, `changedChunk…`; `changedSinceUpdate(id, text)` | cheaper staleness checks in ProjectAnalysis / Recovery |
| handle `lastWordlessReferences()` | Library diagnostics for bound references that carry no text |

## Sous behaviour changes to absorb

- Two new wire codes; 4 presence rows; source-copy rows off by default; lowercase-after-terminal and sticky-key channels on by default. `src/core/findings/finding.ts` `corpusCode` / `corpusSeverity` must name them; the inventory's channel list grows.
- Snapshot id in the header changes when settings change — `ProjectAnalysis` cache keys that assume id == text must include settings.

## Still open on the engine side (engine-asks)

- 2 · Sous census (per-glyph totals for every glyph, sites-by-glyph API).
- 7 · corpus panic → Result on malformed input.

## Verification when done

`pnpm check`; open the fixture; Format book applies and undoes; `/review` shows engine units with word marks; Find scope "Reference" returns hits from a bound reference; match formatting shows the overlay; `cargo check` in src-tauri against `../scripture-kitchen` at the tag.
