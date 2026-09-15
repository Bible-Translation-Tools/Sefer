# Engine asks: what Sefer needs from Onion, Sous and Galley (2026-09-14)

Everything in this file was asked for in the UI build-out and either was not possible with the then-pinned engine (`vendor/galley/manifest.json`, revision `f3a2b0b`) or needed a change upstream in `../scripture-kitchen`. Sefer-side code was already shaped for each; the item names the one door that was missing. Ordered by how much product it unblocks.

**Status, 2026-09-15.** `scripture-kitchen` **v0.1.0** (`4b99047`) closed items 1, 1b, 3, 3b and 5, and Sefer is re-vendored onto it. Items **2** (Sous census), **4** (chapter labels) and **6/7** (corpus panic → `Result`) are open. Each closed item carries a DONE line below.

## 1. Format — re-export `format_edits` from the galley wasm crate

**DONE — v0.1.0.** `formatEdits(text, opts)` is a free function on the module. `Fixes.formatBook(galley, book)` calls it and `Fixes.applyFormat` puts the edits through one `book.apply(…, 'format')`; `FORMAT_DOOR` is deleted and "already formatted" is now a sentence Sefer can say honestly (`FormatPreview.empty`). See `documentation/architecture/findings.md`, "Format".

**Asked:** "Format", for a book or the whole project, from the kebab and the command palette.
**State:** `onion/src/format.rs` exports `format_edits`, `format_edits_in` and `format`; `onion-wasm/src/lib.rs` binds all three. Sefer pins the **galley** wasm crate, and `galley/src/wasm.rs` does not re-export them, so `usfm_galley.d.ts` has no format door.
**Change:** re-export `formatEdits(text, opts)` (edits, not a rewritten string — Sefer applies edits through the Book so Undo is one step) on the `Galley` handle, regenerate the artifact, move the Cargo pin in the same commit.
**Sefer side ready:** `Fixes.formatBook` (refuses today with `Fixes.FORMAT_DOOR` naming this exact ask), `format.book` / `format.project` commands, `MultiBook.runAcrossBooks`. Only `formatBook` changes when the door lands.

## 1b. Diff and merge — re-export Onion's decision-unit diff from galley wasm

**DONE — v0.1.0.** `diff(baseline, current, textMode)`, `merge` and `mergeSplices` are on the module. `diff`'s third argument is a TEXT MODE (`"none" | "words" | "chars"`), not a `utf16` flag — spans are UTF-16 always — and Sefer asks for `"words"`, so `DecisionUnit.text` carries the intra-unit runs. The interim verse-key skeleton is **deleted**, not kept as a fallback (Will, 2026-09-15). See `documentation/architecture/review.md`.

**Asked:** word-level diff inside Save & Review / Compare, and the decision map for taking in work.
**State:** `onion/src/diff.rs` is a full diff engine: `DecisionUnit`s addressed by `Addr { book, chapter, first..last verse, kind }`, `MergeSide::{Baseline, Current}`, slots/anchors, dup contexts; `onion-wasm/src/lib.rs` binds `diff(baseline, current) -> JSON` (UTF-16 spans into each side) and takes `{"unitId": "baseline"|"current"}` decisions back to merge. `galley/src/wasm.rs` does not re-export any of it, so the pinned artifact has no diff door.
**Change:** re-export `diff` and the merge-with-decisions door on the `Galley` handle (same commit as the format re-export; regenerate the artifact and move the Cargo pin).
**Sefer side:** the unified Review/Compare screen is being shaped around `DecisionUnit`s now (`src/core/galley` gets a `diff`/`merge` door that refuses until the artifact carries it; a TS line/word diff feeds the same types in the meantime and is labelled interim). Intra-unit word marks come from the engine's unit spans once the door lands.

## 2. Sous — a real character census, not only convictions

**STILL OPEN at v0.1.0, deliberately** — Will did not build it. `/inventory` still labels itself "the characters the engine measured".

**Asked:** a character-by-character inventory page (occurrences, spread, neighbours, placement, clusters) with "show the other places this character appears".
**State:** the Sous publication's pattern table holds a row only when a channel has a claim to make. On `fixtures/small-nt` that is 11 rows over 10 glyphs, all convicted, zero word patterns. The page therefore labels itself "the characters the engine measured". Will: "current sous doesn't have the full detail; I'll change there."
**Change, per glyph in the corpus (convicted or not):** total sites and per-book spread; the full neighbour table on both sides (exact and pooled); placement against Letter / Space / Digit / Nonletter / Edge; run (cluster) shapes; and **an API that enumerates every site of a glyph or of a pattern**, not only the convicted ones. Rarity's denominator today is the corpus total, so `Glyph.sites` has to take Rarity's numerator and other channels' denominator — a per-glyph total would remove that special case.
**Sefer side ready:** `src/core/findings/inventory.ts` (`inventory`, `sitesOfGlyph`), `Finding.pattern`, `/inventory`. Documented in `documentation/architecture/inventory.md`.

## 3. Match formatting — an overlay of two texts

**DONE — v0.1.0.** The overlay family is on the handle: `skeleton`, `overlay`, `overlayText`, `overlayReport`, `targetNodeFor`, `sourceNodeFor`. `src/core/galley/overlay.ts` is the adapter, `matchFormatting` in `src/app/workflows/stet.ts` is the join, and `/terms?view=format` is the screen. See `documentation/architecture/stet.md`, "Match formatting".

**Asked:** show the source text and highlight the equivalent block in the target so a translator can match paragraphing and poetry to the source.
**State:** not possible from two independent parses; the old app did it in TS by verse anchors (`matchFormattingByVerseAnchors`). Will: "a thing I need to build in Onion to overlay the two."
**Change:** an Onion (or galley) call taking two texts (or two parsed dishes) and returning aligned block spans keyed by verse sid — "this `\q1` in the source corresponds to this span in the target" — with a diff of block markers per verse.
**Sefer side:** `src/app/workflows/stet.ts` `matchFormatting` is an `Effect.die` stub with this signature in mind; the excerpt list already renders source/target pairs per sid.

## 3b. Find over a reference project

**DONE — v0.1.0.** `updateReference(id, text, keepText)` retains the text, the mask and the projection; `findAll(…, scope)` takes `"targets"` / `"references"` / `"all"`. `/find` has the scope control, disabled with its reason until something is bound. See `documentation/architecture/search.md`.

**Asked:** Will: "Find on reference project I think doable in galley."
**State:** `CorpusEngine.updateReference(id, text)` registers a reference as **verse lengths only, no text** — it is the denominator for length proportionality. `CorpusEngine.find` searches the retained verse-text projections of *targets*, so a reference contributes no hits.
**Change:** let a reference retain its verse-text projection too (or an `updateReferenceText` door), and let `find` take a scope: targets, references, or a named reference id. Same hit shape (book, from/to, projected preview) so Sefer's excerpt list needs no change beyond a scope control "This book | Whole project | Reference".
**Sefer side ready:** the Library resolves `source`/`reference` resources per project; `ProjectAnalysis.attach` is where they would be registered.

## 4. Chapter labels — Onion's job

**STILL OPEN.**

**Asked (old app had):** a chapter-label picker rewriting `\cl` / `\cp`.
**Decision:** Will: "will be an Onion thing." Deferred; no Sefer UI planned until the engine defines the operation (likely as edits, like format).

## 5. Find wire buffer — add a magic and version word

**DONE — v0.1.0.** Magic `0x444E4946` ("FIND", 1145981254) and version 1 lead the buffer. `decodeHits` skips both and THROWS `VersionMismatch` on either; `accepts(manifest)` checks the same two at boot.

**From the build-out review (2026-09-13):** the `find` wire buffer (`galley/src/find.rs`, `wire::encode`) carries no magic/version word, unlike the onion and sous buffers, so `accepts(manifest)` cannot catch a reordered record. Add both so a regenerated reader beside a stale manifest fails loudly.

## 6. Native corpus thread — no respawn after a panic

**STILL OPEN**, on both sides — the engine ask (item 7's `Result`) and Sefer's respawn.

**From the review, Sefer's `src-tauri/src/corpus.rs`, but it wraps the engine:** a panic inside `job(&mut sous)` (including inside rayon) kills the owner thread and every later command answers "the corpus thread is not answering" for the process lifetime. Ask for the engine side: `sous` calls that can panic on malformed input should return `Result` instead; Sefer side: respawn the thread and re-register books.

## Not engine asks, recorded so they are not confused with them

- Cloud Combine/Resolve need a branch-move verb on Sefer's Remote port; desktop sync needs four git2 commands in `src-tauri/src/git.rs`.
- Export on Tauri needs a save picker on Sefer's `Dialogs` port.
- Create project needs `ProjectAdmin.create`.
- Verse-by-sid grouping, projection coordinates and the table of contents that Find, Key terms and Compare rely on all work with the current engine; nothing is needed there.
- `Galley.dispose` versus the Layer's finalizer was item 6 here and is not an engine ask: `wasm-bindgen`'s `free()` zeroes the pointer and unregisters the finalizer, so one guard on Sefer's side is the whole fix. Done — `dispose` frees once and ignores later calls (`documentation/architecture/galley.md`, "Loading it").
