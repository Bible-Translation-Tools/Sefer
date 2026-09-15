# Re-vendor galley to scripture-kitchen v0.1.0 — DONE (2026-09-15)

Sefer was pinned at `f3a2b0b` and is now on **v0.1.0** (`4b99047`). One round did
all of it; the commits are on the branch this checklist was worked in.

## Breaking, done in Sefer

- [x] `Knobs` → `SousSettings`, and Sefer's own copy with it; `knobs()`/`setKnobs()` read `settings()`/`setSettings()`. The three new fields (`presence`, `source_copy`, `source_copy_min_run`) were already typed.
- [x] Door renames: `analyze` calls `parseText`; `verseTextOf`/`structureTextOf` are typed and unused, because Sefer's authority for a book's text is the Book and not the corpus.
- [x] **Find wire buffer.** `decodeHits` skips the magic and the version and THROWS `VersionMismatch` on either. `accepts(manifest)` checks the same two at boot from `wire.find`, against `galley.ts`'s own constants — there is no generated reader for this buffer. Engine-asks 5, closed. (The handoff's decimal for the magic was a typo; `0x444E4946` is 1145981254.)
- [x] `find(id, …)` on a reference: the type says so, and the `references` scope is what Sefer actually uses.
- [x] Package shape: `vendor/galley/` takes the committed `galley/pkg-web/`, `onion-wasm/reader.ts`, `galley/sous-reader.ts`, `onion-wasm/diagnostics.json`. The two readers and the catalogue were byte-identical at this tag and were re-copied anyway, because a hash that was not recomputed is a hash nobody checked. `manifest.json`, `accepts`, the Cargo path pin and `vendor/galley/README.md` all moved; the release workflow already reads `engine.revision` out of the manifest, so it needed nothing.

## New doors, where they landed

| door | Sefer consumer | state |
|---|---|---|
| `formatEdits`, `FormatOpts`, `Edits` | `Fixes.formatBook` / `applyFormat` | done; `FORMAT_DOOR` deleted |
| `diff`, `merge`, `mergeSplices` | `Galley.diff`/`merge` → `/review` | done; the interim skeleton is **deleted**, not a fallback |
| `updateReference(id, text, keepText)` | `ProjectAnalysis.attachReferences` | done |
| `findAll(…, scope)` | `Search.findInReferences` → `/find` scope control | done |
| `skeleton`, `overlay`, `overlayReport`, `targetNodeFor`, `sourceNodeFor` | `matchFormatting` → `/terms?view=format` | done |
| `fingerprint`, `changedSinceUpdate` | staleness in ProjectAnalysis | **not used** — see below |
| `lastWordlessReferences()` | a Library note | exposed as `Galley.wordlessReferences()`, not surfaced — see below |
| `toByte`, `toUtf16`, `locate`, `attrs`, `attrResolve`, `book`, `mask`, `parse` | nothing yet | not wired |

### The two that were skipped, and why

- **`fingerprint` / `changedSinceUpdate` for staleness.** They would not simplify anything. `ProjectAnalysis` answers "has this book moved" by comparing two integers it already holds (the Book's revision); replacing that with a wasm call that hashes chunks is slower and answers a question nobody asked. `changedSinceUpdate` IS wired through the Galley service, because "is the corpus's copy of this book out of date" is a different and real question — it currently has no asker.
- **`lastWordlessReferences()` as a Library note.** It is a COUNT, not a list of ids, and it is only ever nonzero while `source_copy` is on — which is off in the engine's defaults and has no settings surface to turn on. A note nothing can produce is dead UI. The door is exposed as `Galley.wordlessReferences()` so the note is one line whenever the settings surface lands.

## Sous behaviour

- [x] Two new wire codes and two new channels. `corpusCode`/`corpusSeverity` and the inventory's channel lists already named all four — the vendored readers were unchanged at this tag, so the previous round had absorbed them ahead of time. Presence is a `warning`; source-copy is `info` and off by default.
- [x] Snapshot id changes with settings. Nothing to do today: ProjectAnalysis' caches are keyed on nothing and are dropped wholesale on every publication and every book change. A settings surface that flips a lane WITHOUT touching text must invalidate them by hand; the note is in `documentation/architecture/findings.md`.

## Still open on the engine side

- 2 · Sous census (per-glyph totals for every glyph, sites-by-glyph API). Deliberately not built.
- 4 · Chapter labels (`\cl` / `\cp`).
- 7 · corpus panic → `Result` on malformed input, and Sefer's respawn beside it.

## Verification

`pnpm check` and `pnpm boundaries` green. `cargo check` in `src-tauri` green against `../scripture-kitchen` at the tag. Browser evidence is in the commit round's report.
