# Vendored Scripture Kitchen engine (Galley)

The pinned WASM artifact Sefer analyzes USFM with: Onion (parser) and Sous
(proofreading) composed upstream into one `Galley` handle, plus Onion's
stateless doors as free functions on the same module. Nothing in Sefer parses
USFM except through this artifact.

Pinned at `scripture-kitchen` **v0.1.2** (`eca6635`). The repository was
`usfm_onion_2` until v0.1.1; the local checkout is `../scripture-kitchen`.

## What is here, and where upstream it comes from

| here | upstream | published as |
| --- | --- | --- |
| `pkg-web/` | `galley/pkg-web/` | `.` / `./web` / `./web/wasm` |
| `onion-reader.ts` | `onion-wasm/reader.ts` | `./reader`, `./schema` |
| `sous-reader.ts` | `galley/sous-reader.ts` | `./sous-reader` |
| `find-reader.ts` | `galley/find-reader.ts` | `./find-reader` |
| `toc-reader.ts` | `galley/toc-reader.ts` | `./toc-reader` |
| `mask-reader.ts` | `galley/mask-reader.ts` | `./mask-reader` |
| `diagnostics.json` | `onion-wasm/diagnostics.json` | `./diagnostics.json` |

`pkg-web/` is the **galley superset** build — every onion door plus the
`Galley` handle. The root package also publishes onion-wasm's own build at
`./onion`, which Sefer does not vendor: the superset already carries it.

- `pkg-web/` — `wasm-pack build --target web --release -- --features wasm` of
  `usfm_galley`. The double dash before `--features` is wasm-pack 0.14's.
  Node loads it with `initSync({ module: bytes })`; the Web host loads it from
  the `?url` asset. Upstream commits `galley/pkg-web/` and CI gates it byte
  for byte against a fresh build, so the copy here is a copy, not a rebuild.
- `onion-reader.ts` — generated reader for the parse buffer.
- `sous-reader.ts` — generated reader for the corpus findings buffer
  (`Galley.publish`), codegen'd and identical to `sous-chef/reader.ts`.
- `find-reader.ts` — generated reader for the find buffer (`find`, `findAll`).
  New at v0.1.1; it replaces the hand-written decoder Sefer used to carry.
- `toc-reader.ts` — generated reader for the TOC buffer (`toc`, `tocAll`).
  New at v0.1.1. Lazy: opening validates the envelope, and a chapter row is
  decoded only when something asks for it. Upstream calls this buffer a
  "census" and its classes `Census`/`BookCensus`/`ChapterRow`; `src/core/galley`
  re-exports them as `ProjectToc`/`BookToc`/`TocChapter`/`TocVerse`, because all
  three upstream names are already spent in Sefer — see the note there.
- `mask-reader.ts` — generated reader for the mask map (`mask`, `maskOf`).
  New at v0.1.2. The map is the source spans a book's READING is made of, in
  order; the reading is a pure concatenation of them, so a host holding the
  text rebuilds the reading and maps an offset in it back to an offset it can
  edit. `src/core/search/reading.ts` is the only consumer, and states what it
  keeps and what it rebuilds.
- `diagnostics.json` — the Onion diagnostic catalogue.
- `manifest.json` — engine revision, the five wire versions and sha256 of
  every file here. `src/core/galley` refuses an artifact whose wire versions it
  does not know.

## The five wire buffers

| buffer | magic | version |
| --- | --- | --- |
| onion parse | `0x534F4E4F` | 4 |
| sous findings | `0x53554F53` | 1 |
| find | `0x444E4946` ("FIND") | 1 |
| toc | `0x53434F54` ("TOCS") | 1 |
| mask | `0x4B53414D` ("MASK") | 1 |

The find buffer's magic and version word are new at v0.1.0 and are read by
`decodeHits` in `src/core/galley/galley.ts`, which refuses a buffer whose
header it does not know rather than decoding plausible nonsense.

## Re-vendoring

Check `../scripture-kitchen` out at the tag, copy the ten files named above, and
rewrite `manifest.json` (revision, date, subject, wire versions, sha256 of each
artifact). Do not edit these files by hand.

`src-tauri/Cargo.toml` no longer pins the crate: the native corpus door was
deleted with `CorpusEngine`, so the wasm artifact is the only engine and there
is no second one to keep in step.
