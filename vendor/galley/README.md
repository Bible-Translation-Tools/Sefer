# Vendored Scripture Kitchen engine (Galley)

The pinned WASM artifact Sefer analyzes USFM with: Onion (parser) and Sous
(proofreading) composed upstream into one `Galley` handle. Nothing in Sefer
parses USFM except through this handle.

- `pkg-web/` — `wasm-pack build --target web` of `usfm_galley` with the `wasm`
  feature. Node loads it with `initSync({ module: bytes })`; the Web host loads
  it from the `?url` asset.
- `onion-reader.ts` — generated reader for the parse buffer (`Galley.parse`).
- `sous-reader.ts` — generated reader for the corpus findings buffer
  (`Galley.publish`).
- `diagnostics.json` — the Onion diagnostic catalogue.
- `manifest.json` — engine revision, wire versions and sha256 of every file
  here. `src/core/galley` refuses an artifact whose wire versions it does not
  know.

Regenerate from `../usfm_onion_2` with the command recorded in the manifest,
copy the four `pkg-web` files plus the two readers and `diagnostics.json`, and
rewrite the manifest hashes. Do not edit these files by hand.
