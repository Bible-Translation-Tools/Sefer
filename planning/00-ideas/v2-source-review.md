# V2 source review and assumptions to refresh

Status: inspection snapshot, 2026-09-04. Read before promoting the [candidate slices](v2-README.md). Source links are relative sibling-repository links for this checkout layout; they are not immutable release references.

## What was inspected

- [Rewrite vision](../../../scripture-editor-proto-2/plans/editor-v2-rewrite-vision.md): product jobs, source/offset rules, ownership, gates, and cutover boundaries.
- Sefer's [manifest](../../package.json), [agent guide](../../AGENTS.md), existing testing/observability architecture notes, and Git discussion. Current scaffold is Solid 2 RC/Vite/Vitest, with jsdom configuration and demonstration routes. This is not an installed Tauri/CodeMirror/Galley application yet.
- [Editor donor handoff](../../../onion-2-spike/NEXT-STEPS-REMEDIATION-HANDOFF.md), especially its final checkpoint and addendum. Inspected donor HEAD: `f8ac262`; working tree was clean. Recorded passes and timings below are donor-authored evidence, not tests rerun here.
- [Pantry contract](../../../usfm_onion_2/galley/src/pantry.md), [Expediter contract](../../../usfm_onion_2/galley/src/sous/expediter.md), selected implementation and [WASM wrapper](../../../usfm_onion_2/galley/src/wasm.rs), [host architecture](../../../usfm_onion_2/galley/docs/analysis-host.md), [package exports](../../../usfm_onion_2/package.json), [Sous roadmap](../../../usfm_onion_2/sous-chef/roadmap.md), and [measurement ledger](../../../usfm_onion_2/sous-chef/evidence.md). HEAD was `730406e`, with substantial modified/untracked Galley/Sous work. These observations describe that live tree, not just that commit or a published release.

## Material changes since the early vision

**The donor's remediation is recorded as complete.** It now records a single project host recipe, declarative mutation phases, shared ownership queries, and removal of duplicate hosts/semantic paths. Do not reopen the earlier remediation list as if nothing landed. Remaining rulings include selection-after-change direction, range-deletion merge policy, and admission after a protection rewrite. Sefer should adjudicate those at adoption rather than silently inheriting them.

**Actual interaction measurement caught problems isolated benches missed.** The donor addendum records redundant structure analysis, satellites each analyzing the full book, oversized decoration builds, and linear scans inside mutation rules. Borrowed canonical structure, memoization, viewport-bounded decoration construction, and indexed lookups reduced those costs. Its artificial-viewport bench had hidden the whole-book decoration problem. The initial mount can still build the full book; browser and packaged-webview evidence are still needed.

**Current Rust Galley retains target text.** Pantry `update` supplies whole-book text; target entries retain a copy. The editor remains canonical. This is different from the earlier invocation-only string ownership thesis. `Expediter` owns mutation through update/remove so corpus caches stay consistent; callers should not mutate an exposed Pantry independently. Dirty baselines still belong to Sefer, not Pantry.

**Composed Rust analysis is ahead of the consumer package.** Expediter provides corpus analysis/publication and site work; the inspected `galley/src/wasm.rs` exports a Warmer-backed cached parser and projected strings, not the full Pantry/Expediter lifecycle. Its `verseText` explicitly discards the coordinate mask. The root package exports the Onion WASM artifacts. A composed consumer release remains an explicit upstream boundary task; do not invent TypeScript calls from Rust method names.

**Identity and ordering need an adapter.** Pantry's caller BookId differs from the parsed USFM BookKey. Duplicate `\id` values can have distinct caller IDs. Canonical engine ordering does not replace the project's manifest/filename ordering. A pattern row index is not a durable finding identity.

**Publication is corpus-wide.** An edit can change the judgment of untouched books. Expensive stages have different cache semantics; word passes do not necessarily retain chapter observations. “Only the edited chapter ever recomputes” is not a valid generic application promise.

**Navigation ranges are not necessarily edit ranges.** The inspected `rebase_span` in [the Sous bridge](../../../usfm_onion_2/galley/src/sous/mod.rs) encloses first-to-last retained bytes across removed markup. That is a useful navigation envelope, but it does not establish that replacing the enclosing raw range is safe. Earlier discussion of rejecting all discontinuous spans is not the current navigation implementation. Exact edit segments or an explicit refusal contract remain necessary at the fix boundary.

**Memory accounting needs whole-process evidence.** The current measurement ledger identifies heap hidden by shallow aggregate-size accounting, plus pass/history caches beyond Warmer's budget. A parser cache limit is not a process-memory ceiling. Recorded native results and earlier lightweight passes cannot certify current browser frame time or memory.

## Contradictions and open upstream work

1. `analysis-host.md` still contains older no-retained-strings/caller-order descriptions alongside the newer architecture. Reconcile it upstream before adopting a public lifecycle contract.
2. Rust capability, generated WASM exports, package exports, and release provenance must agree. Generated readers must match the binary; no vendored reader edited to fit a guessed schema.
3. Reference roles/source comparisons and the word-rule roadmap are not all completed merely because target corpus analysis exists. Confirm each enabled pass against the actual artifact.
4. An exact edit mapping across removed markup is distinct from a display/navigation span. Settle that contract before enabling a replacement from such a finding or search hit.
5. The editor donor is a proving ground. Its passing suite, demo UI, dependency choices, host trust settings, and property rulings do not automatically become Sefer product requirements.

## External tooling check

The current [Tauri WebDriver guide](https://v2.tauri.app/develop/tests/webdriver/) recommends WebdriverIO with `@wdio/tauri-service`, whose embedded driver supports Windows, Linux, and macOS. Direct standalone `tauri-driver` remains Windows/Linux only. Driver choice and test-only plugin packaging need an actual setup proof; renderer-only command interception does not verify IPC.

The supplied Effect v4 FileSystem/PlatformLogger pages could not be retrieved in this pass. No specific v4 logger function signature is certified here. The selected version's declarations and a small real-host probe must decide support, rotation, and cancellation behavior; earlier `PlatformLogger.toFile` wording is a candidate, not an installation recipe.

The X article was supplied as motivation, not used as a verified technical dependency. The operative local requirement is independently clear: agents and humans should inspect real behavior and bounded local evidence.
