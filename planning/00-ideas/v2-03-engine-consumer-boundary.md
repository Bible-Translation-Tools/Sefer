# 03 — A versioned engine consumer boundary

Status: proposed, upstream delivery dependency. Prerequisite: [source review](v2-source-review.md). Owns: Sefer's engine adapter and artifact acceptance; upstream owns parser/proofreader semantics and generated wire formats.

## Outcome and increments

1. Choose and record one usable engine artifact, its build/source identity, generated declarations, reader, and supported capabilities. A parser-only artifact can unblock source/visual experiments, with composed proofreading explicitly unavailable.
2. Exercise load → analyze a whole LF book → read structure/coordinates → dispose through the actual package. Refuse incompatible schema output at the boundary. Do not paste Rust method names into a speculative TypeScript facade.
3. Specify the missing composed WASM wall with the upstream owner: whole-book update/remove, target identity, publication identity, full corpus findings, site retrieval, configuration, and lifecycle. Compare existing binary output approaches only where that wall lacks a format; do not replace the established Onion wire gratuitously.
4. Consume the composed release through a thin versioned adapter. Keep separate raw-byte, canonical-source, revision, and publication identities.

## Contract and failures

CodeMirror offsets are UTF-16; engine raw-source coordinates are UTF-8 unless a specific output is declared UTF-16-ready. Projected/mask coordinates cannot escape unconverted. A stale or mismatched publication cannot become current just because lengths match. Handles have explicit lifetimes; freeing one must not invalidate data promised to be detached.

The inspected Galley WASM wrapper is a cached-parser doorway, not the full Rust Pantry/Expediter API. Projected strings without masks cannot safely power edits.

## Useful proof

Use real packaged WASM and tiny fixtures containing an astral character, non-ASCII scripture, removed markup, and malformed USFM. Assert exact source anchoring and controlled incompatibility/failure behavior, not a duplicate parser corpus. Check both bundler loading and the packaged desktop asset path when present.

## Open questions

One project-level composed handle or coordinated pass handles? Which structures are copied versus borrowed? How is partial parse availability represented while proofreading is unavailable? What is the upstream release path? Do not build a mirrored JS CST or another string-owning editor model to cover a missing API. See [13](v2-13-project-analysis.md) and [14](v2-14-findings.md).
