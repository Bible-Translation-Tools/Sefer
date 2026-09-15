# Vendored Scripture Kitchen engine (Galley)

The pinned WASM artifact Sefer analyzes USFM with: Onion (parser) and Sous
(proofreading) composed upstream into one `Galley` handle, plus Onion's
stateless doors as free functions on the same module. Nothing in Sefer parses
USFM except through this artifact.

Pinned at `scripture-kitchen` **v0.1.0** (`4b99047`). The repository was
`usfm_onion_2` until that tag; the local checkout is `../scripture-kitchen`.

## What is here, and where upstream it comes from

| here | upstream | published as |
| --- | --- | --- |
| `pkg-web/` | `galley/pkg-web/` | `.` / `./web` / `./web/wasm` |
| `onion-reader.ts` | `onion-wasm/reader.ts` | `./reader`, `./schema` |
| `sous-reader.ts` | `galley/sous-reader.ts` | `./sous-reader` |
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
- `diagnostics.json` — the Onion diagnostic catalogue.
- `manifest.json` — engine revision, the three wire versions and sha256 of
  every file here. `src/core/galley` refuses an artifact whose wire versions it
  does not know.

## The three wire buffers

| buffer | magic | version |
| --- | --- | --- |
| onion parse | `0x534F4E4F` | 4 |
| sous findings | `0x53554F53` | 1 |
| find | `0x444E4946` ("FIND") | 1 |

The find buffer's magic and version word are new at v0.1.0 and are read by
`decodeHits` in `src/core/galley/galley.ts`, which refuses a buffer whose
header it does not know rather than decoding plausible nonsense.

## Re-vendoring

Check `../scripture-kitchen` out at the tag, copy the seven files named above,
rewrite `manifest.json` (revision, date, subject, wire versions, sha256 of
each artifact), and move `src-tauri/Cargo.toml`'s path pin in the SAME commit —
the native corpus door and this artifact must be one engine. Do not edit these
files by hand.
