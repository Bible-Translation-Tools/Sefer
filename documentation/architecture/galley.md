# Galley

**Galley** is the adapter over the Scripture Kitchen wasm artifact: Onion (the USFM parser) and Sous (whole-corpus proofreading) composed upstream into one handle. The engine is a TAGGED GIT DEPENDENCY — `@wycliffeassociates/scripture-kitchen`, pinned in `package.json` and resolved in `pnpm-lock.yaml` — and nothing is vendored. `src/core/galley/` is its only code importer (the host loaders `src/platform/{web,node}/galley.ts` only locate the `.wasm` asset); every other module imports `src/core/galley` and reads values, never the readers.

`GalleyService` is one synchronous handle. Besides the parse and the corpus below, its doors are `lint`, `toc`/`tocAll`, `mask`, `readerMask` (the engine's `"text"` recipe, UTF-16: reader text with note prose kept, which Review's reading is cut from), `diff`/`merge` (word runs located, tagged `markup`/`text`/`whitespace`, and flagged `note` inside a footnote or cross-reference; see [review](review.md#word-marks)), `formatEdits`, `skeleton`/`overlay` (a block row's `from..to` is its marker and `from..end` the whole block), `hash` (the engine's `xxh3Text`), `targetNodeFor`/`sourceNodeFor`, `changedSinceUpdate`, and `dispose`. The dish reader's `Tree.enclosing` and `Tree.spansIn` (what markup a range is made of) are available and unused: nothing in Sefer assembles markup extents by hand yet. `version()` reports the `EngineVersion`: the engine, the resolved tag, and the format version of every wire this build's readers speak.

## The one call

`analyze(text, why?, id?, into?): Analysis` is the only place USFM is parsed in the whole application. `id` chooses the door: given one, it registers the text (`update(id, text)`) and then parses the retained copy (`parse(id)`), so no string is marshalled in and a caller cannot get a parse of yesterday's text by holding the id; without one it goes through the loose-text `parseText` door. `into` is the observability service of whoever is asking, so the parse span lands inside the caller's operation. It is **synchronous** and returns a plain value, because it sits on the keystroke path: a fiber per keystroke is a budget Sefer does not have, so Effect stops at the Layer. It always asks the engine for the one wants set — diagnostics, table of contents, UTF-16 offsets — because structure and diagnostics come out of the same walk and the editor needs both on the keystroke that typed the mistake. There is no cheaper mode worth a second code path.

`Analysis` is `{ dish, text, docLen, sourceHash, revision, engineMs, usfmVersion }`, immutable. `dish` is the reader's cursors over the parse buffer: `tree`, `tokens`, `diagnostics`, `toc`. `analyze` throws `EngineInputError` when the text contains `\r` — canonical text is LF, and `Source` already refuses a carriage return on the way in and on every edit.

`memoize()` returns a per-Book memo: the same text hands back the same `Analysis` instance, so a gesture that reads the analysis three times costs one parse and an undo back to a text we have seen costs none. One memo per Book, held by whatever owns that Book's editor state.

## Freshness

`sourceHash` is the engine's xxh3-64 of the source bytes — the content identity core itself never computes (see [Source and Book](source.md)). `GalleyService.hash(text)` computes the same value without a parse, which is what Save's dirty and external-change comparison use. Two doors read it from an analysis:

- `sameSource(a, b)` — hash plus length. Parse-to-parse identity without holding either string.
- `describesExactly(analysis, text)` — length, then the full comparison. The strict door for anything about to index into `text` by offset.

`stampOf(analysis)` gives the `EngineStamp { docLen, sourceHash }` every derived product carries, and `stampMatches(stamp, analysis)` is the check a consumer makes before acting on one. Length alone never identifies text: a same-length edit is the ordinary case, and length-as-identity is the bug the pair exists to defeat.

## The corpus half

The same handle holds the project: `update(id, text)` registers or replaces one whole book as a proofreading target and returns its canonical `\id` code; `updateReference(id, text, keepText?)` registers one as a declared source. `publish()` opens a `FindingsSnapshot` over one complete publication. A snapshot **replaces** the previous one whole: row positions are valid only inside the buffer they came from, so findings from two snapshots are never held side by side. `settings()`/`setSettings(patch)` copy the judging configuration in and out as a plain object (the wasm `SousSettings` handle never escapes), and a settings flip costs a re-judge, not a re-map. `residentBytes()` reports the handle's whole footprint.

`keepText` is the choice v0.1.0 added, and it is a real one. Omitted, a reference is verse lengths and nothing else — all the length lane needs, and the cheap case. `true` keeps the text, the mask and the UTF-16 table a target keeps, which is what Find's `references` scope and the overlay doors read, at what a target costs minus the resident analysis. A project binds a source to be compared against; only some of those are also searched or overlaid, so the caller says which.

`SousSettings` was `Knobs` before v0.1.0, and it gained three fields with it: `presence` (verse coverage against a paired reference, ON), `source_copy` (consecutive words a target shares with its paired source verse, OFF) and `source_copy_min_run`. Source-copy is off by default because a legitimately borrowed proper name would otherwise be a finding in every verse that carries one. `wordlessReferences()` counts the declared sources the last publication's source-copy lane wanted to read and could not, because they were registered while the lane was off — nonzero means "re-send those references' text", not "nothing was found".

Both halves read the same warm chunk cache inside the handle, which is why they are one service and not two.

## Find, over the projection

`find(id, query)` and `findAll(query, scope?)` search the engine's **verse-text projection** — the reading, not the markup — and place every hit back in the source. Since v0.1.0 `find(id, …)` reads ANY registered book that retains text — a target, or a reference registered with `keepText` — and errors only when the book retains none, because answering "no hits" would say it was clean. `scope` is `"targets"` (the default), `"references"` or `"all"`; a reference registered without its text is in no scope at all, since it retains nothing to search. `FindQuery { text, caseSensitive?, wholeWord?, limit? }` is LITERAL: the engine's find is `memmem` and the `regex` crate is deliberately not one of its dependencies, so a regex query belongs to the raw scan in [Search](search.md). `limit` bounds hits across the whole call, and `0`/omitted means no bound.

`EngineHit { bookId?, projected, source, preview }` carries **both coordinate spaces**, because they are not the same interval:

- `projected` — where the hit sits in the projection. What a highlighter or a second search wants.
- `source` — where its bytes are in canonical USFM, **one range per contiguous piece**. `source.length > 1` means the hit crossed markup the projection dropped, and the gaps between the pieces are exactly that markup. Nothing hands back a single bounding range that would swallow a footnote.
- `preview` — the projected text around the hit, ellipsed for a result card. Display only. It rides in the buffer because the projection is materialized per search and dropped with it; a host that wanted the string afterwards would have to mask the whole book again.

Whether the markup between two pieces survives a replacement is the caller's decision and the engine refuses to make it (`galley/src/find.md`, "Replacement is the caller's"). Search's answer is to refuse the replacement, not to guess.

A private `decodeHits(bytes)` turns the buffer both doors emit into `EngineHit`s through scripture-kitchen's generated `Hits` reader (`find-reader`), so Sefer knows no offsets or strides and the layout cannot drift from the writer. Nothing outside this module reads an engine buffer. `Hits.open` **throws** on a wrong magic or version without reading the rest: a find buffer decoded against the wrong layout yields ranges that look like offsets into scripture and are not, and an editor acting on one would splice the wrong text.

## One engine, in the webview

The corpus calls are plain synchronous members of the same `GalleyService` the editor parses through, on **both** hosts; there is no separate corpus port. They run off the keystroke path — once per scheduler pass, not per keystroke — so a synchronous call there costs a pass, not a frame.

It is one handle because `parse(id)` and `lint(id)` answer off the text a handle **retains**: a corpus living in another process is a corpus the parse path cannot name, and a second one would mean every book's text crossing the wall twice. The cost is that a cold publication of 66 books maps on one thread. The engine's cold publish is off the critical path — the sidebar draws from the census, not from findings — so a Worker, if it is ever needed, answers that without a second engine.

## What is still open upstream

The Sous **census** (engine-asks item 2) is open and deliberately so: Will did not build it. The pattern table therefore still holds a row only where a channel had a claim to make, and `/inventory` still labels itself "the characters the engine measured" rather than a census. See [Character inventory](inventory.md).

Chapter labels (`\cl` / `\cp`) are Onion's job and deferred (item 4).
