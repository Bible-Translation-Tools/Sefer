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

---

**Status, 2026-09-17.** Sefer is pinned to **v0.1.2** (`eca6635`, "the mask map crosses the wall"). Items **2**, **4** and **6/7** are still open. Items **8–10** below are new, and came out of building the diff playground (`src/dev/playground/`, commits `be7720b`…`2446072`) against real project text. Item **11** is not an ask — it is Will's counter-proposal to the whole `Filter` shape, written down with the measurement that bears on it.

## 8. Spans on the diff's text runs

**Asked:** one diff surface that reads continuously — unchanged verses beside changed ones, in reading order (the `continuous` and `excerpts` playground experiments).

**State:** such a surface has to render two kinds of row and there are two different maskers behind them. A CHANGED unit's words are the engine's, via `unit_text_diff` over `Filter::reader_text`. An UNCHANGED unit has no runs, so Sefer projects it itself with `core/excerpts`' `project`, which is `Filter::verse_text`. Measured against the four committed fixtures, the two agree on every reader-visible character of 59 units, differing only in trailing whitespace. **They disagree about notes**, by design on both sides:

```
engine (reader_text): Paul, a servant of God1:1 Some manuscripts read slave. and an apostle…
ours  (verse_text):   Paul, a servant of God and an apostle…
```

`Filter::reader_text`'s own doc says why it must be that way: *"Nothing is `Action::Remove`d, so no text is unreachable."* That is a diff-CORRECTNESS property, not a preference — a filter that removes text makes that text undiffable and a merge over it could lose bytes. So the diff cannot simply be handed `verse_text()`, and "let the page pick one filter" is not the fix.

**Change:** put the source span on a run. `TextDiffRun { text, kind }` becomes `{ text, kind, from, to }`, in the same UTF-16 space the unit's own `baseline`/`current` spans already use. A consumer holding a display rule can then suppress the note bytes *inside* a run without re-diffing and without the engine giving up totality. This is the smallest change that closes the divergence.

**Sefer side ready:** `src/dev/playground/units.tsx` renders runs and carries the finding above `sideText`; `src/app/ui/review/reading.ts` is the one place the second masker is called. `/review` does not hit the divergence — its cards read one unit at a time and are never mixed with unchanged ones.

## 9. `Filter` across the wasm boundary — or at minimum `readerText`

**Asked:** the same reading rule on a diff row, an excerpt card and a find hit.

**State:** `onion::mask::Filter` is already a wasm-shaped value — *"Config only — no predicate, no callback: one API for Rust and for a wasm caller that can only hand over data"* — with `resolve()` as the boundary pre-flight and a documented precedence (marker beats kind). The boundary throws it away. `onion_wasm::mask(text, recipe)` takes a string and accepts two names:

```rust
"verseText" => Filter::verse_text(),
"structure" => Filter::structure(),
other => throw_str(…expected "verseText" or "structure")
```

`Filter::reader_text()` — the one the diff uses — **is not reachable from JavaScript at all**, and neither is any composed filter. The `Galley` handle's `mask(id, opts)` has the same two recipes.

**Change:** accept a `Filter` on the mask doors, as `{ filter: { kinds, markers, unknowns, text, newlines, attrLists, optBreaks } }` beside the existing `recipe`. If that is more surface than is wanted now, `"readerText"` as a third recipe name closes most of it. `ReaderText::new` hardcodes `Filter::reader_text()` and already takes a `Mask`, so parameterising the diff is one line — and then a page and its diff can be made to agree by construction rather than by luck.

**Keep the presets.** A free filter is more expressive than `Filter`'s three-way `Action`, which means more ways to ask for an incoherent view (keep `\f*` without `\f`). The named recipes encode the combinations that mean something; they should stay the front door.

**Sefer side ready:** `src/core/galley/*` is one thin adapter per door; `core/excerpts.project` would become a mask read rather than its own walk.

## 10. The enclosing node of a span

**Asked:** flip ONE result to markup-visible — one find hit, one diff row, one seated range — without flipping the surface (Will, 2026-09-17: *"in find, if we wanted to flip just one result, conceptually I'd like to"*).

**State:** half of it needs nothing. `onion-wasm::diff` documents its spans as *"UTF-16 offsets into each side's own document"*, which is the space a JS string is already in, so a decision unit's markup is `text.slice(unit.current.from, unit.current.to)`. That is wired up and works (`2446072`) — clicking the reference in the margin flips that row.

It does not finish for a find hit. A unit is a block, so its span carries its own `\v` and `\p`. A hit is a word, and the `\add ` in front of it sits OUTSIDE the span. `MaskMap.pieces(from, to)` says where the gaps inside the span are — *"the bytes BETWEEN two pieces are exactly the markup the projection dropped"* — but nothing says where the wrapper begins. `Cst::extent(node, tokens)` computes it in Rust; the exported parts are `owners`, `parents`, `first_token`, `last_token`, and assembling them in JS is the tree-walking the no-strings-cross rule exists to prevent.

**Change:** `enclosing(text, from, to, utf16) -> { from, to, marker }` — the smallest CST node covering a span, in source coordinates, with the marker spelling it holds. Total: a span in front matter answers the block it sits in. `attrs(text, from, to, utf16)` is the precedent for a span-in, words-out door.

**Sefer side ready:** `src/dev/playground/units.tsx` `sourceOf` does the unit case today; `/find`'s excerpt cards are where the hit case goes. A UI note from the demo: a flipped row REFLOWS, because markup is longer than the reading of it, and in a multibuffer that shifts every excerpt below — so the flip probably wants to be a popover rather than an in-place swap.

## 11. `classify` instead of `mask` — Will's counter-proposal, and what the corpus says

Not an ask. Will, 2026-09-17: what if the primitive were `classify` rather than `mask` — every byte range carrying one or more TAGS (`[pad]`, `[markup, charMarker]`, …), one pass, and every view then a predicate over tags on the consumer's side, with the backwards map falling out for free? *"You diff the whole thing, and show/hide usfm for any u32..u32."*

**What it gets right, and it is the strongest part of the idea.** `Action` is three-way today for one reason, stated in its own doc: a scope-opening marker has two different drops — *"`\add`'s text is wanted where its markers are not (`Unwrap`), and a footnote's text is wanted nowhere (`Remove`)"*. Tags dissolve that. `\f`'s opener and closer get `markup, noteShell`; the note's prose gets `text, inNote`. Then verse text is *keep `text`, reject `inNote`*, reader text is *keep `text`*, structure is *keep `markup`, reject `inNote`* — and `Unwrap` stops being a third action, because it was only ever "accept the child's tag, reject the parent's". Footnotes get easier, not harder.

**Why not just the lexed tokens, then.** Because a token stream cannot answer it. `mask.rs` says so directly: *"The mask walks the CST rather than the token stream because 'text is not verse text' is a SCOPE fact: the `why` inside a footnote dies because the footnote dies, which is one skipped subtree here and a stateful guess on a flat stream."* Which is the precise description of what `classify` would be: the token stream with its CST ancestry flattened onto each range, so that the consumer's predicate can be stateless. That is the thing tokens lack and the thing every filter question is actually about.

**The lookup worry is unfounded.** Producing a string from a tag list is one linear pass with a predicate — O(ranges), the same as `Mask::text` today. Tags cost nothing there. Random access (`toSource` on a hit) is a binary search either way.

**The verbosity worry is real, and it is a multiplier on an existing cliff.** A mask is MAXIMAL — adjacent survivors merge — which is why en_ulb's verse-text mask is only ~80k ranges. A classifier cannot merge across a tag change, so its range count is bounded below by the token count. Counted over the real corpus (`testData/exampleCorpora/en_ulb`, 72 files, 4.51 MB): 80,635 markers and 92,208 lines, so a classification is on the order of 300k ranges — roughly 3.7× the mask, and ~3.6 MB on the wire against the mask's 645 KB. Fine, in absolute terms.

It is not fine where `mask.md` already says it is not fine. Word-aligned en_ult measures **1,607,157 mask ranges, 12.9 MB of map for 4.2 MB of kept text** — *"On word-aligned text the map is larger than the projection it describes"* — and a classification of the same corpus would be 3–4× that again, 40 MB and up. So `classify` does not change the aligned story; it multiplies it.

**Where that lands.** The model is right and the wire is not. Classification belongs INSIDE the engine, as what `mask` is computed from — one pass, tags on ranges, and `Filter` reduced to a tag predicate, which would be a real simplification of `Filter` (no `kinds` array, no three-way `Action`, no per-marker name resolution). What crosses the boundary stays a `MASK` buffer, cut to the predicate the caller asked for, because 645 KB of answer beats 3.6 MB of raw material a consumer has to reduce itself. Under that reading, item 9 is not "expose `Filter`" so much as "expose the predicate", and the tag vocabulary is what it should be written in.

**The cost of doing it.** The tag vocabulary becomes a wire-versioned public enum, so adding a tag is a format change; `Filter` today can gain a field without renumbering anything. And a free tag predicate can express views that do not mean anything, which is what the named recipes are for. Both are arguments for the predicate being the inner layer and the recipes staying the door.
