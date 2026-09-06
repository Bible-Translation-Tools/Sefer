# 29 — Measure the whole interaction and working set

Status: proposed cross-cutting gate, not an optimization program. Prerequisites: actual editor/engine/host slices. Owns: reproducible application evidence and complexity-promotion decisions.

## Outcome and increments

1. Keep one small ordinary fixture and a representative large book/project with provenance. Record build, hardware, host, workload, enabled passes, diagnostic level, and cold/warm conditions.
2. Measure actual input → admission/phases → engine → structure → decorations → publication/fan-out → browser rendering. Separate exclusive costs from nested totals to avoid double-counting. Measure mount, scroll, and multiple surfaces as well as steady typing.
3. Measure total application memory and retained lifetimes across edit/Undo/book switching/removal/reopen. Include WASM high-water memory, JS source/history, Pantry text, Warmer, pass aggregate/history caches, and view products.
4. Investigate only a demonstrated over-budget owner. Prefer existing indexed queries, avoiding duplicate computation, viewport work limits, or bounded cache policy before adding workers/resident protocols.

## Contract and evidence limits

The user's target is synchronous ordinary editor/Galley work within a frame. A nominal 60 Hz frame is about 16.7 ms, and the editor does not own all of it. Agree acceptance hardware and tail-latency budgets from a baseline; native microbenchmarks alone cannot pass that gate.

The donor's synthetic viewport hid expensive whole-book decoration work; its interaction meter exposed it. Current Galley memory evidence also found heap omitted by shallow aggregate accounting. Warmer's cache budget is not a total-process ceiling. Do not quote old lightweight-pass warm timings as proof for current word/corpus analysis.

## Useful proof

A repeatable real keystroke scenario plus a targeted memory-lifetime run answers the first questions. Run the larger corpus/stress tier when changing the relevant algorithm or before release, not on every debug test. Save one concise measurement record; do not create a dashboard stack or copy sibling stress suites.

## Open questions

What is the supported low-end field device? How much headroom is needed for IME and trace volume? Does initial mount need a seeded range? If composed publication misses the target, which specific stage can be improved, and what explicit freshness contract would a scheduling change require? No worker/IPC redesign without measured attribution and owner choice.
