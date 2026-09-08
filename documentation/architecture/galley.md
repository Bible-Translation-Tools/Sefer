# Galley

**Galley** is the adapter over the pinned Scripture Kitchen wasm artifact in `vendor/galley/`: Onion (the USFM parser) and Sous (whole-corpus proofreading) composed upstream into one handle. `src/core/galley/` is the only importer of `vendor/`; every other module imports `src/core/galley` and reads values, never the readers.

## The one call

`analyze(text): Analysis` is the only place USFM is parsed in the whole application. It is **synchronous** and returns a plain value, because it sits on the keystroke path: a fiber per keystroke is a budget Sefer does not have, so Effect stops at the Layer. It always asks the engine for the one wants set — diagnostics, table of contents, UTF-16 offsets — because structure and diagnostics come out of the same walk and the editor needs both on the keystroke that typed the mistake. There is no cheaper mode worth a second code path.

`Analysis` is `{ dish, text, docLen, sourceHash, revision, engineMs, usfmVersion }`, immutable. `dish` is the reader's cursors over the parse buffer: `tree`, `tokens`, `diagnostics`, `toc`. `analyze` throws `EngineInputError` when the text contains `\r` — canonical text is LF, and `Source` already refuses a carriage return on the way in and on every edit.

`memoize()` returns a per-Book memo: the same text hands back the same `Analysis` instance, so a gesture that reads the analysis three times costs one parse and an undo back to a text we have seen costs none. One memo per Book, held by whatever owns that Book's editor state.

## Freshness

`sourceHash` is the engine's xxh3-64 of the source bytes — the content identity core itself never computes (see [Source and Book](source.md)). Two doors read it:

- `sameSource(a, b)` — hash plus length. Parse-to-parse identity without holding either string.
- `describesExactly(analysis, text)` — length, then the full comparison. The strict door for anything about to index into `text` by offset.

`stampOf(analysis)` gives the `EngineStamp { docLen, sourceHash }` every derived product carries, and `stampMatches(stamp, analysis)` is the check a consumer makes before acting on one. Length alone never identifies text: a same-length edit is the ordinary case, and length-as-identity is the bug the pair exists to defeat.

## The corpus half

The same handle holds the project: `update(id, text)` registers or replaces one whole book as a proofreading target and returns its canonical `\id` code; `updateReference(id, text)` registers one as a declared source — verse lengths only, no text, no findings of its own. `publish()` opens a `FindingsSnapshot` over one complete publication. A snapshot **replaces** the previous one whole: row positions are valid only inside the buffer they came from, so findings from two snapshots are never held side by side. `knobs()`/`setKnobs(patch)` copy the judging configuration in and out as a plain object (the wasm `Knobs` handle never escapes), and a knob flip costs a re-judge, not a re-map. `residentBytes()` reports the handle's whole footprint.

Both halves read the same warm chunk cache inside the handle, which is why they are one service and not two.

## Loading it

`GalleyLive(bytes)` is a scoped Layer: it checks the handshake, instantiates the module once, opens the handle, and frees it in a finalizer. It takes bytes rather than fetching them so core stays free of both `node:fs` and `fetch`; the hosts supply them.

- `src/platform/web/galley.ts` — `WebGalleyLive`, the wasm as a `?url` asset, fetched. The Tauri webview shares this path.
- `src/platform/node/galley.ts` — `NodeGalleyLive`, read with `node:fs`. Tests and tooling only.

`accepts(manifest)` returns `Result<void, VersionMismatch>`, comparing the manifest's `wire.onion.formatVersion` and `wire.sous.formatVersion` against the two readers' own `FORMAT_VERSION` constants — not against a number written in Sefer, so a regenerated reader beside a stale manifest disagrees loudly instead of agreeing with a copy of neither. A mismatched buffer decodes into plausible nonsense, and nonsense about scripture structure is worse than a boot failure.

`analyze` emits one `analyze` span and one `analyze` note when `Observability` is in context, carrying counts only (`diag=N`) — never a diagnostic's message, which quotes the document.

## Regenerating the artifact

See `vendor/galley/README.md`. The build command and the engine revision are recorded in `vendor/galley/manifest.json`, along with a sha256 of every vendored file. Copy the four `pkg-web` files, the two readers and `diagnostics.json`, rewrite the manifest hashes, and never edit those files by hand.

## What the handle cannot do yet

The stateless Onion doors the spike used are **not** on this handle: there is no `format`, `formatEdits`, `attrs`, `attrResolve` or `locate`. A diagnostic still carries its own `fix()` edits, so the fix path works; whole-document formatting, attribute resolution and the `locate` string do not, and neither does corpus search. Sous exposes no `find`. When Sefer needs one of those, the ask goes upstream to the engine's wasm surface — the adapter does not reimplement it.
