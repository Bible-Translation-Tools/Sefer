# Galley

**Galley** is the adapter over the pinned Scripture Kitchen wasm artifact in `vendor/galley/`: Onion (the USFM parser) and Sous (whole-corpus proofreading) composed upstream into one handle. `src/core/galley/` is the only importer of `vendor/`; every other module imports `src/core/galley` and reads values, never the readers.

## The one call

`analyze(text): Analysis` is the only place USFM is parsed in the whole application. It goes through the engine's `parseText` door — since scripture-kitchen v0.1.0 the plain name `parse` takes a registered book's **id** and answers off the text the corpus retains, and the loose-text door is the one with `Text` on the end. The editor's text is the authority, not the corpus's, so the keystroke path pays for the string crossing the wall; the chunk cache keys on content, so an unregistered copy of a registered book still hits it. It is **synchronous** and returns a plain value, because it sits on the keystroke path: a fiber per keystroke is a budget Sefer does not have, so Effect stops at the Layer. It always asks the engine for the one wants set — diagnostics, table of contents, UTF-16 offsets — because structure and diagnostics come out of the same walk and the editor needs both on the keystroke that typed the mistake. There is no cheaper mode worth a second code path.

`Analysis` is `{ dish, text, docLen, sourceHash, revision, engineMs, usfmVersion }`, immutable. `dish` is the reader's cursors over the parse buffer: `tree`, `tokens`, `diagnostics`, `toc`. `analyze` throws `EngineInputError` when the text contains `\r` — canonical text is LF, and `Source` already refuses a carriage return on the way in and on every edit.

`memoize()` returns a per-Book memo: the same text hands back the same `Analysis` instance, so a gesture that reads the analysis three times costs one parse and an undo back to a text we have seen costs none. One memo per Book, held by whatever owns that Book's editor state.

## Freshness

`sourceHash` is the engine's xxh3-64 of the source bytes — the content identity core itself never computes (see [Source and Book](source.md)). Two doors read it:

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

`decodeHits(bytes)` reads the buffer both doors emit — magic, version, then little-endian `u32` throughout, offsets in UTF-16, layout stated once in `galley/src/wasm.md` ("The find buffer"). It is exported from `src/core/galley` because the desktop door reads the same bytes off IPC; nothing outside this module decodes an engine buffer.

**The header is new at v0.1.0 and it is checked twice.** The find buffer used to carry no magic and no version, unlike the onion and sous buffers, so a reordered record could only be caught by the nonsense it produced — engine-asks item 5, now closed on both sides. `decodeHits` skips the two leading words and **throws `VersionMismatch`** on either, without reading the rest: a find buffer decoded against the wrong layout yields ranges that look like offsets into scripture and are not, and an editor acting on one would splice the wrong text. `accepts(manifest)` checks the same two at boot, so a mis-vendored artifact fails before a search rather than during one.

## Two doors, one publication

The corpus half runs somewhere other than the main JavaScript thread on desktop, and `CorpusEngine` (`src/core/galley/corpus.ts`) is the seam that lets it. It is a narrow, deliberately **asynchronous** port over the calls that run off the keystroke path: `update`, `updateReference`, `remove`, `publish`, `residentBytes` — and `find`. Find is on the corpus port and not on `Galley` because the corpus is what HOLDS the retained texts and masks: on desktop the books were registered across IPC and their projections live in the native Pantry, so the search has to run where they are. Two implementations:

- `WasmCorpusLive` (Web, and the Layer's default everywhere) delegates to the wasm handle in this process. The asynchrony is nominal — one fiber step per scheduler pass, not per keystroke.
- `NativeCorpusLive` (`src/platform/tauri/corpus.ts`) invokes the commands in `src-tauri/src/corpus.rs`, where the **same engine crate** is linked natively with its `parallel` feature, so a publication's chapter map goes wide on rayon. `corpus_publish` and `corpus_find` answer with `tauri::ipc::Response`, so those buffers cross as raw bytes and arrive as an `ArrayBuffer` rather than a JSON array of numbers.

The find buffer is encoded by `galley::find::wire` on both sides — the wasm handle and the native `Expediter::find` — for the same reason the publication is one format: two encoders would drift, and a misread offset into scripture points at the wrong bytes.

The engine is not `Send` — its chunk cache shares a chapter's products between books through `Rc`, which is the right call for a single-owner structure — so the desktop host gives it one owner thread for the life of the process and every command posts a closure to it. That is also better than a lock: a `Mutex` on a tokio worker would block that worker for the length of a publication.

**The bytes are identical.** Not an aspiration: the engine's own conformance tests pin the native `Expediter`, the wasm `Galley` handle and the JS reader against one set of golden buffers (`galley/src/wasm.md`, "The claim"), and `galley/tests/equivalence.rs` pins the parallel chapter map against the serial one. `FindingsSnapshot.open` reads either, and `ProjectAnalysis` cannot tell which door ran except from the `analyze.publish` span, whose note carries `wasm` or `native`.

The `Galley` handle is still the only USFM parser, on both hosts. `analyze` never crosses this seam and never will; the desktop build links the engine without its `wasm` feature and exposes no parse command. Judging settings also stay on the wasm handle — the shell's settings surface reads and writes them, and a setting that lived in two places would be a setting that disagreed with itself.

**The stateless doors and the overlay doors are on the wasm handle only.** `formatEdits`, `diff`, `merge` and the overlay family are not on the `CorpusEngine` port and have no Tauri command behind them. For the first three that is correct and permanent: they are stateless free functions over strings the caller already holds, so there is nothing to gain by crossing IPC. For the overlay family it is a real constraint — the doors read two REGISTERED books, and on desktop the corpus's registrations live in the native process. `src/app/workflows/stet.ts` answers it by registering both sides with the wasm handle itself before asking, which costs the source's text being resident twice on desktop and makes the view behave identically on both hosts.

### The cold paths that remain

Stated plainly, because "desktop uses rayon now" is not the same as "nothing is cold":

1. **Wasm instantiation at boot.** `GalleyLive` fetches and `initSync`s the module before the first keystroke, on both hosts. Unavoidable while the editor's parse is in wasm.
2. **The initial serial `analyze` of every book on `attach`.** `ProjectAnalysis.attach` parses each book one at a time on the main thread — on BOTH hosts, because the parse cannot move. It is a project-open cost, not an interaction cost (vision §11.1), and it is the largest remaining one.
3. **The Web corpus publish is still main-thread.** `WasmCorpusLive` is a synchronous call in a fiber. A Worker is the next step and the port's signature is already the one it needs; only that Layer changes.

Everything else on the corpus path is off the JS thread on desktop.

### Where the native engine comes from

`src-tauri/Cargo.toml` names `usfm_galley` (and `sous-core`, for the `Brigade` pass galley does not re-export) as a **path** dependency on the sibling `scripture-kitchen/` checkout, with `features = ["parallel"]` and deliberately without `wasm`. That is the same working tree the vendored wasm was built from — tag `v0.1.0`, revision `4b9904789a65c95cd9bf90a4c57a33588103403c`, recorded in `vendor/galley/manifest.json` — which is what makes "one engine, two doors" true rather than approximately true. When the engine is pushed, those two lines become `git = "…/scripture-kitchen.git", rev = "<the manifest revision>"`, and regenerating the wasm artifact means moving the Cargo pin in the same commit.

## Loading it

`GalleyLive(bytes)` is a scoped Layer: it checks the handshake, instantiates the module once, opens the handle, and frees it in a finalizer. It takes bytes rather than fetching them so core stays free of both `node:fs` and `fetch`; the hosts supply them.

`dispose()` is **idempotent**, and the finalizer goes through it rather than round it: the service holds the handle in one slot, takes it out before calling `free()`, and a later call finds nothing to free. `wasm-bindgen`'s `free()` zeroes the pointer and unregisters the finalizer, so a second free of the same object is a double free of the Rust allocation — which is what a caller who obeyed the old doc and disposed early would have caused when the Layer's scope closed. One owner, one free. `galley.test.ts` pins it.

- `src/platform/web/galley.ts` — `WebGalleyLive`, the wasm as a `?url` asset, fetched. The Tauri webview shares this path.
- `src/platform/node/galley.ts` — `NodeGalleyLive`, read with `node:fs`. Tests and tooling only.

`accepts(manifest)` returns `Result<void, VersionMismatch>` and checks **three** wires. The manifest's `wire.onion.formatVersion` and `wire.sous.formatVersion` go against the two readers' own `FORMAT_VERSION` constants — not against a number written in Sefer, so a regenerated reader beside a stale manifest disagrees loudly instead of agreeing with a copy of neither. The find buffer has no generated reader — `decodeHits` in `galley.ts` is it — so `wire.find.magic` and `wire.find.formatVersion` go against that module's own constants, which is the same discipline with the reader and the constant in one place. A mismatched buffer decodes into plausible nonsense, and nonsense about scripture structure is worse than a boot failure.

`analyze` emits one `analyze` span and one `analyze` note when `Observability` is in context, carrying counts only (`diag=N`) — never a diagnostic's message, which quotes the document.

## Regenerating the artifact

See `vendor/galley/README.md`. The build command and the engine revision are recorded in `vendor/galley/manifest.json`, along with a sha256 of every vendored file. Copy the four `pkg-web` files, the two readers and `diagnostics.json`, rewrite the manifest hashes, and never edit those files by hand.

## The stateless doors: format, diff, merge

Onion's stateless doors arrive as **free functions on the wasm module**, not as methods on the handle. They are stateless, so a handle method would be a claim about ownership that is not true; the handle keeps the things that hold state — the corpus, the chunk cache, the settings. v0.1.0 carries `parse`, `mask`, `format`, `formatEdits`, `formatEditsIn`, `diff`, `merge`, `mergeSplices`, `toByte`, `toUtf16`, `locate`, `attrs`, `attrResolve` and `book`, plus the `FormatOpts`, `Edits` and `Splices` classes.

`src/core/galley/format.ts` and `src/core/galley/diff.ts` bind the three Sefer uses, and both **probe the module namespace by name**. That is the reason they still answer `Result`: an artifact that is not the vendored build is a real failure mode, and it should refuse by name (`DIFF_DOOR`) rather than throw a `TypeError` about `undefined` or, worse, be quietly replaced by a second opinion about scripture.

**Format.** `formatEdits(text, opts)` answers an `Edits` — a transaction, not a rewritten document. That is the whole reason Sefer asks for it rather than `format`: the edits go through one `book.apply(…, 'format')`, so a whole-book normalisation is one revision, one receipt and **one Undo step**. A replaced document would undo correctly too and be unreadable in a diff. Offsets are UTF-16 always — `formatEdits` converts on the way out, on an index it builds per call. The `FormatOpts` handle is built, filled and freed inside the call; no caller holds a wasm handle. Sefer passes no options: the engine's own defaults are what "Format" means, and a dozen switches is a settings surface nobody has designed. See [Findings](findings.md).

**Diff and merge.** `diff(baseline, current, textMode)` — the third argument is a TEXT MODE (`"none" | "words" | "chars"`), not a `utf16` flag; the diff's spans are UTF-16 into each side's own document always. Sefer asks for `"words"`, which is UAX-29 word runs over the engine's own reader-text mask, and is what the review screen draws. The engine rejects a misspelled mode rather than falling back.

`onion/src/diff.rs` cuts each side into blocks at its own table-of-contents anchors (front matter, chapter open, verse), pairs them by a deliberately loose key — book + chapter + verse START, so a moved or rebridged verse still pairs and a renumbered one reads as a delete plus an add — and answers with a `DiffSkeleton`: an interleave of `Slot`s in which every byte of both inputs bears exactly one, plus a list of `DecisionUnit`s carrying `kind`, `status`, each side's own `Addr` and UTF-16 span, `displaced`, `relabeled`, a cross-document `DupContext`, a `CoveredBy` narration for a verse a bridge covers on the other side, the intra-unit `text` runs, and the two facts a review screen wants most — `isWhitespaceChange` and `isUsfmStructureChange`. `merge` takes decisions back as `{"unitId": "baseline"|"current"}` and walks the interleave, which is what makes a moved or coalesced unit land where it belongs.

**There is no second diff.** The verse-alignment stand-in that carried `/review` before v0.1.0 is deleted (Will, 2026-09-15). `src/core/diff/skeleton.ts` is what is left of it: a cache over the two texts, because the review re-derives on every shell tick. See [Review](review.md).

## Match formatting: the overlay doors

`skeleton(id, opts?)`, `overlay(targetId, sourceId, opts?)`, `overlayText`, `overlayReport`, `targetNodeFor` and `sourceNodeFor` are on the HANDLE, because they read two REGISTERED books. `src/core/galley/overlay.ts` is the adapter; `galley/src/overlay.md` is the contract. Engine-asks item 3, closed.

Four ideas carry the whole model:

1. **A block ADDRESS, not an offset.** `{ sid, where, ordinal, marker }`: which verse, whether the block sits immediately before the verse's `\v` (`leading`) or after its text (`inside`), which one of those it is, and what it is called. Two documents with different words and different lengths can share an address and nothing else.
2. **`marker` is a CHECK, not the key.** The position is the key. If the position still exists but now spells something else, the node doors **throw** ("… names q2 but the node there is q1 — the address is stale") rather than answering about a different node.
3. **An inserted INSIDE block arrives EMPTY.** Where a verse's text splits is unknowable across languages, so the transaction inserts the marker and no words; `overlayReport.inserted[].empty` says which, and the screen shows a placeholder. The file holds an empty block; nothing is invented.
4. **It is a SUGGESTION, applied on request.** Never a finding, never automatic.

`overlay` answers the same `Edits` class `formatEdits` does, so an editor applies an overlay exactly as it applies a fix — one transaction, one Undo step. Offsets are BYTES unless `utf16` is asked for: the unit is a property of the call, not of the engine. Sefer has no byte offsets and must never acquire one, so `overlayOptions` in `overlay.ts` sets `utf16: true` in the one place every call goes through.

For the live highlight, fetch `skeleton()` for BOTH sides once per edit (~0.4 ms each) and match addresses in TypeScript as the cursor moves. `targetNodeFor`/`sourceNodeFor` are ~1.4 ms and are for one-off questions — "where would this go?" — not for a per-keystroke loop. See [Key terms (STET)](stet.md).

## What the handle has that Sefer does not use

`fingerprint(text)` and `changedSinceUpdate(id, text)` are on the handle and Sefer uses **neither for staleness**. `ProjectAnalysis` answers "has this book moved" from the Book's own revision number, which is a comparison of two integers it already holds; replacing that with a wasm call that hashes chunks would be slower and would answer a question nobody asked. `changedSinceUpdate` is wired through the service anyway, because "is the corpus's copy of this book out of date" is a different question and a real one — it currently has no asker.

`lint(id)`, `verseText(id)` and `parse(id, …)` — the by-id doors that read a registered book's retained text — are likewise unused: Sefer's authority for a book's text is the Book, not the corpus, so every parse goes through the loose-text door with the editor's own string.

## What is still open upstream

The Sous **census** (engine-asks item 2) is open and deliberately so: Will did not build it. The pattern table therefore still holds a row only where a channel had a claim to make, and `/inventory` still labels itself "the characters the engine measured" rather than a census. See [Character inventory](inventory.md).

Chapter labels (`\cl` / `\cp`) are Onion's job and deferred (item 4). Hardening the native corpus thread's panics into a `Result` is item 7.
