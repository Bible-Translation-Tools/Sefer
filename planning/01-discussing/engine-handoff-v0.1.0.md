# Engine handoff: scripture-kitchen v0.1.0 → Sefer (2026-09-15)

The engine repo moved and got a tag. Pull the tag, rebuild the vendored
artifact, then work through the API changes below. Everything here was
verified green on the tagged tree: 905 native tests, 55 release binaries,
reader tests 8/8, onion-wasm node test 7, galley wall test 13, both
conformance scripts OK, committed `pkg-*` byte-identical to a fresh build.

## The tag

| | |
| --- | --- |
| repo | `git@github.com:WycliffeAssociates/scripture-kitchen.git` (was `usfm_onion_2`; local checkout `../scripture-kitchen`) |
| tag | `v0.1.0` — every Cargo.toml and package.json says `0.1.0`; CI's release job refuses a tag that disagrees |
| npm | `npm i github:WycliffeAssociates/scripture-kitchen#v0.1.0` → `@wycliffeassociates/scripture-kitchen` |
| build (vendoring) | `cd galley && wasm-pack build --target web --release -- --features wasm` — or take the COMMITTED `galley/pkg-web/` as is: it is built by `galley/build.sh` with path remapping and CI gates it byte for byte |

`vendor/galley/manifest.json`: set `engine.spec` to `../scripture-kitchen`,
`engine.revision` to the tag's commit, and re-hash the artifacts. The build
command now needs `-- --features wasm` after a double dash (wasm-pack 0.14).

## Package layout (changed)

Root package `@wycliffeassociates/scripture-kitchen`, exports:

| subpath | what |
| --- | --- |
| `.` / `./web` / `./web/wasm` | **galley's** build — the superset module: every onion door plus the `Galley` handle |
| `./onion` / `./onion/web` / `./onion/web/wasm` | onion-wasm's build, for an onion-only consumer |
| `./reader` | onion's parse-buffer reader (`onion-reader.ts` in the vendor dir) |
| `./sous-reader` | sous's findings reader (`galley/sous-reader.ts`, codegen'd — identical to `sous-chef/reader.ts`) |
| `./schema`, `./diagnostics.json` | unchanged |

## Wire (record in the manifest)

| buffer | magic | version | change |
| --- | --- | --- | --- |
| onion parse | `0x534F4E4F` (1381453391) | 4 | unchanged |
| sous findings | `0x53554F53` (1398099795) | 1 | two new rule codes: 3 SourceCopy (off by default), 4 Presence (on); channels 8 LetterRun and 9 SentenceStart; header snapshot id now changes with settings |
| **find** | **`0x444E4946` ("FIND", 1145980230)** | **1** | **NEW two leading u32 words before `hitCount`, `bookCount`; skip them and refuse a mismatch** |

## Breaking API changes on `Galley`

1. `Knobs` → **`SousSettings`**. `config()` / `setConfig()` unchanged. New fields: `presence`, `source_copy`, `source_copy_min_run`.
2. Loose-text onion doors renamed (the plain names now take an **id**):
   `parse(text,…)` → `parseText(text,…)`; `verseText(text)` → `verseTextOf(text)`; `structureText(text)` → `structureTextOf(text)`.
3. `find(id, …)` searches any registered book that retains text (Target or Reference); errors only when the book kept none.
4. Find buffer header (above).

## New on the module (free functions, onion-wasm's names) — ask 1

`parse`, `mask`, `format`, `formatEdits`, `formatEditsIn`, `diff(baseline, current, textMode)`, `merge`, `mergeSplices`, `toByte`, `toUtf16`, `locate`, `attrs`, `attrResolve`, `book`; classes `FormatOpts`, `Edits`, `Splices`.
`Fixes.formatBook` → `formatEdits(text, opts)`. `diff` now takes `"none" | "words" | "chars"` and rejects a typo; `"none"` is byte-identical to the old output.

## New on the handle

| door | notes |
| --- | --- |
| `parse(id, diagnostics, toc, utf16)`, `lint(id)`, `verseText(id)` | off the retained text; a Reference without text or a products-only Target throws naming the fact |
| `fingerprint(text) → Fingerprint` (`differsFrom`, `changedChunks` as from/to pairs, `chunkCount`), `changedSinceUpdate(id, text)` | dirty vs rework |
| `updateReference(id, text, keepText?)` | `true` keeps text + mask + UTF-16 table so the Reference can be searched and overlaid; default `false`, current calls stand |
| `findAll(needle, caseSensitive, wholeWord, limit, scope?)` | `"targets"` (default), `"references"`, `"all"` — ask 3b |
| `lastWordlessReferences()` | paired References without a word lane while source-copy is on |
| **overlay family — ask 3** | `skeleton(id, opts?, utf16?) → JSON`, `overlay(targetId, sourceId, opts?) → Edits`, `overlayText(…) → string`, `overlayReport(…) → JSON`, `targetNodeFor(targetId, sourceId, address, opts?, utf16?) → JSON`, `sourceNodeFor(…) → JSON` |

Overlay: `opts = { markers?: string[], scope?: {chapter} | {sid}, utf16?: boolean }`;
offsets are BYTES unless `utf16: true` (`formatEdits` is always UTF-16 — the
unit is a property of the call). Addresses are `{ sid, where: "leading"|"inside",
ordinal, marker }`; the node doors REQUIRE `marker` and throw on a stale one.
Inside blocks arrive EMPTY (`overlayReport.inserted[].empty`) — show a
placeholder; the file holds an empty block, never invented words. Live
highlight: fetch `skeleton()` for both sides once per edit (~0.4 ms each) and
match addresses in TS; the node doors are for one-off questions (~1.4 ms).
Contract: `galley/src/overlay.md`; wire: `galley/src/wasm.md` "The overlay doors".

## Sefer-side items from the review (not engine)

- `dispose` must be idempotent in the wrapper: wasm-bindgen's `free()` unregisters the finalizer, so free once and drop the reference.
- Respawn the corpus thread after a panic and re-register books (defensive; no engine panic has been observed).
- Census (ask 2) is paused; chapter labels (ask 4) are onion's, deferred.

## Not for Sefer's code

Classifier moved to `mise`; CI now gates galley's committed binary, runs the reader tests and both conformance scripts; the root `package.json` is derived by `node package-root.mjs` from both inner packages (`files`/`exports`), never edited by hand.
