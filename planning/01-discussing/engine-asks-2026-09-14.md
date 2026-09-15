# Engine asks: what Sefer needs from Onion, Sous and Galley (2026-09-14)

Everything in this file was asked for in the UI build-out and either is not possible with the pinned engine (`vendor/galley/manifest.json`, revision `f3a2b0b`) or needs a change upstream in `../usfm_onion_2`. Sefer-side code is already shaped for each; the item names the one door that is missing. Ordered by how much product it unblocks.

## 1. Format — re-export `format_edits` from the galley wasm crate

**Asked:** "Format", for a book or the whole project, from the kebab and the command palette.
**State:** `onion/src/format.rs` exports `format_edits`, `format_edits_in` and `format`; `onion-wasm/src/lib.rs` binds all three. Sefer pins the **galley** wasm crate, and `galley/src/wasm.rs` does not re-export them, so `usfm_galley.d.ts` has no format door.
**Change:** re-export `formatEdits(text, opts)` (edits, not a rewritten string — Sefer applies edits through the Book so Undo is one step) on the `Galley` handle, regenerate the artifact, move the Cargo pin in the same commit.
**Sefer side ready:** `Fixes.formatBook` (refuses today with `Fixes.FORMAT_DOOR` naming this exact ask), `format.book` / `format.project` commands, `MultiBook.runAcrossBooks`. Only `formatBook` changes when the door lands.

## 2. Sous — a real character census, not only convictions

**Asked:** a character-by-character inventory page (occurrences, spread, neighbours, placement, clusters) with "show the other places this character appears".
**State:** the Sous publication's pattern table holds a row only when a channel has a claim to make. On `fixtures/small-nt` that is 11 rows over 10 glyphs, all convicted, zero word patterns. The page therefore labels itself "the characters the engine measured". Will: "current sous doesn't have the full detail; I'll change there."
**Change, per glyph in the corpus (convicted or not):** total sites and per-book spread; the full neighbour table on both sides (exact and pooled); placement against Letter / Space / Digit / Nonletter / Edge; run (cluster) shapes; and **an API that enumerates every site of a glyph or of a pattern**, not only the convicted ones. Rarity's denominator today is the corpus total, so `Glyph.sites` has to take Rarity's numerator and other channels' denominator — a per-glyph total would remove that special case.
**Sefer side ready:** `src/core/findings/inventory.ts` (`inventory`, `sitesOfGlyph`), `Finding.pattern`, `/inventory`. Documented in `documentation/architecture/inventory.md`.

## 3. Match formatting — an overlay of two texts

**Asked:** show the source text and highlight the equivalent block in the target so a translator can match paragraphing and poetry to the source.
**State:** not possible from two independent parses; the old app did it in TS by verse anchors (`matchFormattingByVerseAnchors`). Will: "a thing I need to build in Onion to overlay the two."
**Change:** an Onion (or galley) call taking two texts (or two parsed dishes) and returning aligned block spans keyed by verse sid — "this `\q1` in the source corresponds to this span in the target" — with a diff of block markers per verse.
**Sefer side:** `src/app/workflows/stet.ts` `matchFormatting` is an `Effect.die` stub with this signature in mind; the excerpt list already renders source/target pairs per sid.

## 4. Chapter labels — Onion's job

**Asked (old app had):** a chapter-label picker rewriting `\cl` / `\cp`.
**Decision:** Will: "will be an Onion thing." Deferred; no Sefer UI planned until the engine defines the operation (likely as edits, like format).

## 5. Find wire buffer — add a magic and version word

**From the build-out review (2026-09-13):** the `find` wire buffer (`galley/src/find.rs`, `wire::encode`) carries no magic/version word, unlike the onion and sous buffers, so `accepts(manifest)` cannot catch a reordered record. Add both so a regenerated reader beside a stale manifest fails loudly.

## 6. Galley handle — `dispose` versus the finalizer

**From the review:** `Galley.dispose` is public and the finalizer also calls `handle.free()`; a caller obeying the doc double-frees. Either make dispose idempotent on the wasm side or drop one of the two. Sefer-side fix is possible too; noting it here because the contract belongs to the handle.

## 7. Native corpus thread — no respawn after a panic

**From the review, Sefer's `src-tauri/src/corpus.rs`, but it wraps the engine:** a panic inside `job(&mut sous)` (including inside rayon) kills the owner thread and every later command answers "the corpus thread is not answering" for the process lifetime. Ask for the engine side: `sous` calls that can panic on malformed input should return `Result` instead; Sefer side: respawn the thread and re-register books.

## Not engine asks, recorded so they are not confused with them

- Cloud Combine/Resolve need a branch-move verb on Sefer's Remote port; desktop sync needs four git2 commands in `src-tauri/src/git.rs`.
- Export on Tauri needs a save picker on Sefer's `Dialogs` port.
- Create project needs `ProjectAdmin.create`.
- Verse-by-sid grouping, projection coordinates and the table of contents that Find, Key terms and Compare rely on all work with the current engine; nothing is needed there.
