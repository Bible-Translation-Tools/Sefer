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

## Two doors, one publication

The corpus half runs somewhere other than the main JavaScript thread on desktop, and `CorpusEngine` (`src/core/galley/corpus.ts`) is the seam that lets it. It is a narrow, deliberately **asynchronous** port over exactly the five calls `ProjectAnalysis` makes off the keystroke path: `update`, `updateReference`, `remove`, `publish`, `residentBytes`. Two implementations:

- `WasmCorpusLive` (Web, and the Layer's default everywhere) delegates to the wasm handle in this process. The asynchrony is nominal — one fiber step per scheduler pass, not per keystroke.
- `NativeCorpusLive` (`src/platform/tauri/corpus.ts`) invokes the commands in `src-tauri/src/corpus.rs`, where the **same engine crate** is linked natively with its `parallel` feature, so a publication's chapter map goes wide on rayon. `corpus_publish` answers with `tauri::ipc::Response`, so the buffer crosses as raw bytes and arrives as an `ArrayBuffer` rather than a JSON array of numbers.

The engine is not `Send` — its chunk cache shares a chapter's products between books through `Rc`, which is the right call for a single-owner structure — so the desktop host gives it one owner thread for the life of the process and every command posts a closure to it. That is also better than a lock: a `Mutex` on a tokio worker would block that worker for the length of a publication.

**The bytes are identical.** Not an aspiration: the engine's own conformance tests pin the native `Expediter`, the wasm `Galley` handle and the JS reader against one set of golden buffers (`galley/src/wasm.md`, "The claim"), and `galley/tests/equivalence.rs` pins the parallel chapter map against the serial one. `FindingsSnapshot.open` reads either, and `ProjectAnalysis` cannot tell which door ran except from the `analyze.publish` span, whose note carries `wasm` or `native`.

The `Galley` handle is still the only USFM parser, on both hosts. `analyze` never crosses this seam and never will; the desktop build links the engine without its `wasm` feature and exposes no parse command. Judging knobs also stay on the wasm handle — the shell's settings surface reads and writes them, and a knob that lived in two places would be a knob that disagreed with itself.

### The cold paths that remain

Stated plainly, because "desktop uses rayon now" is not the same as "nothing is cold":

1. **Wasm instantiation at boot.** `GalleyLive` fetches and `initSync`s the module before the first keystroke, on both hosts. Unavoidable while the editor's parse is in wasm.
2. **The initial serial `analyze` of every book on `attach`.** `ProjectAnalysis.attach` parses each book one at a time on the main thread — on BOTH hosts, because the parse cannot move. It is a project-open cost, not an interaction cost (vision §11.1), and it is the largest remaining one.
3. **The Web corpus publish is still main-thread.** `WasmCorpusLive` is a synchronous call in a fiber. A Worker is the next step and the port's signature is already the one it needs; only that Layer changes.

Everything else on the corpus path is off the JS thread on desktop.

### Where the native engine comes from

`src-tauri/Cargo.toml` names `usfm_galley` (and `sous-core`, for the `Brigade` pass galley does not re-export) as a **path** dependency on the sibling `usfm_onion_2/` checkout, with `features = ["parallel"]` and deliberately without `wasm`. That is the same working tree the vendored wasm was built from — revision `663403ac0f2bb2aa1b5dba9efd2601f35ffd28ac`, recorded in `vendor/galley/manifest.json` — which is what makes "one engine, two doors" true rather than approximately true. When the engine is pushed, those two lines become `git = "…/scripture-kitchen.git", rev = "<the manifest revision>"`, and regenerating the wasm artifact means moving the Cargo pin in the same commit.

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
