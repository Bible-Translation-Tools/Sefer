# Galley

**Galley** is the adapter over the Scripture Kitchen wasm artifact: Onion (the USFM parser) and Sous (whole-corpus proofreading) composed upstream into one handle. The engine is a TAGGED GIT DEPENDENCY — `@wycliffeassociates/scripture-kitchen`, pinned in `package.json` and resolved in `pnpm-lock.yaml` — and nothing is vendored. `src/core/galley/` is its only importer; every other module imports `src/core/galley` and reads values, never the readers.

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

## One engine, in the webview

The corpus half — `update`, `updateReference`, `remove`, `publish`,
`residentBytes`, and `find` — sits behind `CorpusEngine`
(`src/core/galley/corpus.ts`), a narrow **asynchronous** port over the calls
that run off the keystroke path. Find is on the corpus port and not on `Galley`
because the corpus is what HOLDS the retained texts and masks: the search has
to run where they are.

There is one implementation, `WasmCorpusLive`, and it delegates to the same
wasm handle the editor parses through, on **both** hosts. The asynchrony is
nominal today — one fiber step per scheduler pass, not per keystroke — and it
is kept because a Worker is the next step and it needs exactly this signature.

**There used to be two.** `NativeCorpusLive` invoked Tauri commands over a
natively-linked `usfm_galley` with its `parallel` feature, so a publication's
chapter map went wide on rayon and did not run on the thread that paints the
editor. It was deleted when Sefer moved to the id doors, and the reason is
structural rather than a preference: `parse(id)` and `lint(id)` answer off the
text a handle **retains**, so a corpus living in another process is a corpus the
parse path cannot name. Keeping both meant every book's text crossing the wall
twice — once to register natively, once to parse in wasm — which the engine's
maintainer measured as most of what we were wasting on a project open.

What that cost: a cold publication of 66 books maps on one thread now rather
than ten. What it bought: one resident copy of the project instead of two, and
a parse path that names a book instead of re-sending it. The engine's cold
publish is off the critical path — the sidebar draws from the census, not from
findings — so the thread it runs on is a background question, and a Worker
answers it without a second engine.

## What is still open upstream

The Sous **census** (engine-asks item 2) is open and deliberately so: Will did not build it. The pattern table therefore still holds a row only where a channel had a claim to make, and `/inventory` still labels itself "the characters the engine measured" rather than a census. See [Character inventory](inventory.md).

Chapter labels (`\cl` / `\cp`) are Onion's job and deferred (item 4). Item 7 — hardening the native corpus thread's panics into a `Result` — is closed by deletion: there is no native corpus thread.
