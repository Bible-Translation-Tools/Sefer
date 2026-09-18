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

**Status, 2026-09-17.** Sefer is pinned to **v0.1.2** (`eca6635`, "the mask map crosses the wall"). Items **2**, **4** and **6/7** are still open. Items **8–10** below are new, and came out of building the diff playground (`src/dev/playground/`, commits `be7720b`…`2446072`) against real project text. Item **11** is not an ask — it is Will's counter-proposal to the whole `Filter` shape, written down with the measurement that bears on it, and the conclusion was to keep `Filter`.

## How items 8–10 are framed

Will, 2026-09-17, setting the rule for this round:

> What's generically reasonable for a library to support, but doesn't have to conform to Sefer's mental model or way of doing things if a reasonable workaround exists. Asking the right questions (ie is this a paragraph) is allowed, but not having to know and parse USFM in general. We want as much USFM knowledge in the tested libs in isolation.

So each item below is written as a CAPABILITY a USFM library would reasonably own, not as a shape Sefer wants back. Three tests applied before anything was listed:

1. **Is it already there?** Two of the four capabilities this round started from turned out to be delivered, and are therefore NOT asks — see below.
2. **Is there a reasonable workaround?** If Sefer can get it from what already crosses, it does not go in this file.
3. **Is it a question about USFM, or a question about Sefer?** "Is this range markup" is the former. "Give me runs shaped for my renderer" is the latter, and gets rewritten until it is the former or dropped.

### Already delivered — do not ask

**The diff is already complete over the whole document.** `DiffSkeleton.slots` is documented as *"The interleave: every byte of both inputs, in exactly one bearing slot"*, and `units` includes `Status::Unchanged`. Measured on the playground: Genesis produces 1,594 units of which 1,531 are unchanged. A consumer that wants a continuous surface has everything it needs; Sefer's `inOrder` walks the slots and gets reading order for free.

**"Is this change only in the markup" is already answered.** `DecisionUnit.is_usfm_structure_change` — *"Not whitespace-only, but the reader-visible text is the same: markup changed and nothing else"* — and `is_whitespace_change` beside it. Both are on the wire and Sefer renders the first as a badge today.

## 8. Values that describe a region of the document should say which region

**The capability:** anything the library hands back that describes part of a document is addressable in that document.

This is the library's own stated convention, not a Sefer preference. `mask.rs`: *"CONVENTION: **public offsets are always SOURCE bytes.** A consumer finds 'doubled word at 12..17 of the mask', calls `Mask::to_source` twice, and files its diagnostic in document coordinates."* Every other output honours it — decision units, find hits, lint findings, `Edits`, TOC rows, mask ranges, `attrs` quadruples.

**The one exception:** `TextDiffRun { text: String, kind: RunKind }`. A run is a region of a document — the library found it, by lexing and masking and segmenting — and it comes back as a bare string. A consumer that wants to do anything with a run other than print it has to re-derive where it was by searching for its text, which is ambiguous and which is Sefer re-implementing the engine's own arithmetic.

**Change:** `TextDiffRun { text, kind, from, to }`, in the UTF-16 space the unit's own `baseline`/`current` spans already use. Four numbers per run.

**Why this is the whole ask, and why there is no workaround without it.** With a run located, Sefer needs nothing further from the library to reconcile the two readings: both masks are pure concatenations of source spans over the same document, so the verse-text reading of a reader-text run is the concatenation of the verse-text ranges its span overlaps, with `kind` carried onto each piece — `ReaderText::slice`'s loop, run in JavaScript over the mask `maskOf` already ships. WITHOUT the span there is no workaround at all: a run is an unanchored string. That is the test in rule 2, and it is the only item this round that fails it.

**What the divergence is, for context.** A continuous diff surface renders changed rows from the engine's runs (`Filter::reader_text`, note prose rides in) and unchanged rows from Sefer's own projection (`Filter::verse_text`, notes dropped). Measured over the four committed fixtures the two agree on every reader-visible character of 59 units, differing only in trailing whitespace; they disagree about notes:

```
reader_text: Paul, a servant of God1:1 Some manuscripts read slave. and an apostle…
verse_text:  Paul, a servant of God and an apostle…
```

Both are correct. `reader_text` MUST keep note prose — *"Nothing is `Action::Remove`d, so no text is unreachable"* is a diff-correctness property, since text a filter removes is text a merge could lose. So the library is not being asked to change what it diffs over, only to say where the runs are.

**Sefer side ready:** `src/dev/playground/units.tsx` renders runs and carries the finding above `sideText`; `src/app/ui/review/reading.ts` is the one place the second masker is called.

## 9. What is this range made of — one structural query

**The capability:** answer, for a source range, what USFM it is composed of — which sub-spans are marker, designator, attribute list, note shell, text; what marker owns them; and what encloses the range as a whole.

This is the "is this a paragraph" question in the rule above, generalised one step, and it is a question about USFM rather than about any consumer. Three unrelated callers want it:

- **Lint / diagnostics.** Marking an unknown `\s5` means knowing the marker's extent, not just its offset. Any rule about markup needs the markup's boundaries.
- **Toggling markup for a range.** A hit found in a projection sits inside `\add …\add*`; the wrapper is outside the hit's span, and `MaskMap.pieces` reports the gaps INSIDE a span, never the enclosure around it. `Cst::extent(node, tokens)` computes it in Rust; the exported pieces are `owners`, `parents`, `first_token`, `last_token`, and assembling them in JavaScript is exactly the "parse USFM in general" the rule excludes.
- **Reducing a reading to a narrower one,** for a caller that would rather ask than intersect two masks.

**Change:** one door, span in and spans out, in the shape `attrs` already established (`attrs(text, from, to, utf16)` — a span in, flat words out):

```
spansIn(text, from, to, utf16) -> [{ from, to, kind, marker?, depth? }]
enclosing(text, from, to, utf16) -> { from, to, marker }       // or the outermost row of the above
```

**Deliberately NOT the `classify` wire.** This is the same question item 11 asks, restricted to a range the caller already has, so it costs a bounded walk and no format: no version word, no generated reader, no staleness test, and none of the 3.6 MB a whole-document classification measured. The range restriction is what makes the generic version affordable.

**Workaround check:** partial, and only for one caller. A decision unit's markup is already `text.slice(unit.current.from, unit.current.to)`, because `onion-wasm::diff` documents its spans as *"UTF-16 offsets into each side's own document"* — wired up and working (`2446072`). A find hit's wrapper has no workaround, and neither does a lint rule that wants a marker's extent.

**Sefer side ready:** `src/dev/playground/units.tsx` `sourceOf` for the unit case; `/find`'s excerpt cards for the hit case. A UI note from the demo: a flipped row reflows, because markup is longer than the reading of it, so the toggle probably wants to be a popover rather than an in-place swap.

## 10. The library has three tested reading rules; two are reachable

**The capability:** a reading rule the library defines, tests and relies on internally is one a consumer can ask for by name.

Not a design ask — a packaging gap, and the cheapest item here. `onion::mask::Filter` has three presets: `verse_text()`, `reader_text()`, `structure()`. The boundary exposes two:

```rust
"verseText" => Filter::verse_text(),
"structure" => Filter::structure(),
other => throw_str(…expected "verseText" or "structure")
```

`Filter::reader_text()` — the rule the diff itself runs on — is not reachable from JavaScript at all. A consumer therefore cannot reproduce the reading its own diff rows are written in, which is how two maskers ended up on one page.

**Change:** `"readerText"` as a third recipe name on `mask`, `maskOf` and the handle's `mask(id, opts)`. That is the whole of it.

**Optionally, and only if a second consumer asks:** accept a `Filter` value rather than a name. The type is already built for it — *"Config only — no predicate, no callback: one API for Rust and for a wasm caller that can only hand over data"* — with `resolve()` as the boundary pre-flight and a documented precedence. But a free filter can express views that mean nothing (keep `\f*` without `\f`), and the named recipes are what encode the combinations that do, so the names should stay the front door either way.

**Workaround check:** with item 8 landed, yes — intersecting two masks gets Sefer the same answer. This item is what makes a consumer able to ASK instead of compute, which is the rule's preference, but it is not a blocker.

## 10b. A skeleton block's span is its marker, and nothing says so

**Smallest item here, and a DOCUMENTATION ask by the rule above** — the
workaround exists and is now verified, so this is not an API change.

**The capability:** a value that carries a span says which span.

**State.** `skeleton()` answers two row types with the same field names and
different meanings. A VERSE carries `{from, to, textFrom, textTo}` — its `\v`
marker, and its text. A BLOCK carries `{from, to}` and no second pair, and that
span is the MARKER ONLY: `\p` is two characters. Nothing in `wasm.md` or
`overlay.md` says which of the two a block's span is, and the field names are
the ones that mean "the text" on the row above it.

Sefer walked straight into it: `blockAtOffset` was written as a containment
test against those spans, and on Genesis that is 491 two-character spans in a
204,738-character document, so it answered "no block here" almost everywhere.
Our own `SkeletonRow` doc said "an address, its span, and whether it holds
words", which is the same ambiguity restated (fixed).

**Measured before relying on the workaround**, because "the next block's marker"
is only a safe extent if the rows behave: over `testData/exampleCorpora/en_ulb`,
66 books, **31,720 block rows — every one 6 characters or fewer, none out of
order, none overlapping**. So a block runs from its own marker to the next
one's, and `core/galley/overlay.ts`'s `blockExtents` derives exactly that.

**Change:** one sentence in `overlay.md` saying a block row's span is its
marker. Optionally give blocks the `textFrom`/`textTo` verses already carry,
which would make the two row types read the same way — but that is an API
change for something a caller can compute, and by the rule above it does not
qualify on its own.

**Sefer side:** done. `blockExtents` / `blockAtOffset` / `equivalentExtent` in
`core/galley/overlay.ts`, used by the block pairing in `ReferencePane`.

## 11. `classify` instead of `mask` — Will's counter-proposal, and what the corpus says

Not an ask. Will, 2026-09-17: what if the primitive were `classify` rather than `mask` — every byte range carrying one or more TAGS (`[pad]`, `[markup, charMarker]`, …), one pass, and every view then a predicate over tags on the consumer's side, with the backwards map falling out for free? *"You diff the whole thing, and show/hide usfm for any u32..u32."*

**What it gets right, and it is the strongest part of the idea.** `Action` is three-way today for one reason, stated in its own doc: a scope-opening marker has two different drops — *"`\add`'s text is wanted where its markers are not (`Unwrap`), and a footnote's text is wanted nowhere (`Remove`)"*. Tags dissolve that. `\f`'s opener and closer get `markup, noteShell`; the note's prose gets `text, inNote`. Then verse text is *keep `text`, reject `inNote`*, reader text is *keep `text`*, structure is *keep `markup`, reject `inNote`* — and `Unwrap` stops being a third action, because it was only ever "accept the child's tag, reject the parent's". Footnotes get easier, not harder.

**Why not just the lexed tokens, then.** Because a token stream cannot answer it. `mask.rs` says so directly: *"The mask walks the CST rather than the token stream because 'text is not verse text' is a SCOPE fact: the `why` inside a footnote dies because the footnote dies, which is one skipped subtree here and a stateful guess on a flat stream."* Which is the precise description of what `classify` would be: the token stream with its CST ancestry flattened onto each range, so that the consumer's predicate can be stateless. That is the thing tokens lack and the thing every filter question is actually about.

**The lookup worry is unfounded.** Producing a string from a tag list is one linear pass with a predicate — O(ranges), the same as `Mask::text` today. Tags cost nothing there. Random access (`toSource` on a hit) is a binary search either way.

**The verbosity worry is real, and it is a multiplier on an existing cliff.** A mask is MAXIMAL — adjacent survivors merge — which is why en_ulb's verse-text mask is only ~80k ranges. A classifier cannot merge across a tag change, so its range count is bounded below by the token count. Counted over the real corpus (`testData/exampleCorpora/en_ulb`, 72 files, 4.51 MB): 80,635 markers and 92,208 lines, so a classification is on the order of 300k ranges — roughly 3.7× the mask, and ~3.6 MB on the wire against the mask's 645 KB. Fine, in absolute terms.

It is not fine where `mask.md` already says it is not fine. Word-aligned en_ult measures **1,607,157 mask ranges, 12.9 MB of map for 4.2 MB of kept text** — *"On word-aligned text the map is larger than the projection it describes"* — and a classification of the same corpus would be 3–4× that again, 40 MB and up. So `classify` does not change the aligned story; it multiplies it.

**What it does not buy.** It does not fix item 8. The footnote divergence is caused by the diff needing a TOTAL filter, not by `Filter`'s shape — under tags the diff still emits runs over a total predicate and those runs still carry no offsets, so the bug is untouched. It overlaps item 9, which asks the same question restricted to a range the caller already holds — and that restriction is the whole difference: a bounded walk against a whole-document format. And it reshapes item 10 cosmetically — "expose the predicate" instead of "expose a recipe name" — where `Filter` already exists, is documented as wasm-shaped, has `resolve()` as its boundary pre-flight, and is exercised by three presets. Against that, a tag vocabulary is a new wire format: a version word, a generated reader, a staleness test at both ends per this workspace's own rule, and a migration of mask, diff, find and the Sous seam. `mask.md` also already records that `ticket`'s fixed-width vocabulary is what rules out a run-length form — the same constraint a tag word would meet.

**Recommendation: keep `Filter`, do items 8–10 as framed above.** The insight worth keeping from this is a comment, not a refactor: `Unwrap` is "accept the child's tag, reject the parent's", which is why the three-way `Action` is the shape it is. If `Action` ever needs a FOURTH case, that is the signal the tag model has started earning its keep.

**Where the model would land if it were built.** It is right about the representation and wrong about the wire. Classification belongs INSIDE the engine, as what `mask` is computed from — one pass, tags on ranges, and `Filter` reduced to a tag predicate, which would be a real simplification of `Filter` (no `kinds` array, no three-way `Action`, no per-marker name resolution). What crosses the boundary stays a `MASK` buffer, cut to the predicate the caller asked for, because 645 KB of answer beats 3.6 MB of raw material a consumer has to reduce itself. Under that reading, item 10 is not "expose `Filter`" so much as "expose the predicate", and the tag vocabulary is what it should be written in — and item 9 is the same query with a range bound on it, which is the affordable half.

**The cost of doing it.** The tag vocabulary becomes a wire-versioned public enum, so adding a tag is a format change; `Filter` today can gain a field without renumbering anything. And a free tag predicate can express views that do not mean anything, which is what the named recipes are for. Both are arguments for the predicate being the inner layer and the recipes staying the door.
