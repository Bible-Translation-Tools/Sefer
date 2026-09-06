# 13 — Project census and composed analysis

Status: proposed; composed consumer package is a gate. Prerequisites: [03](v2-03-engine-consumer-boundary.md), [04](v2-04-source-and-book-lifetime.md), [09](v2-09-platform-storage.md). Owns: project inputs, freshness, and publication integration. Upstream owns analysis semantics.

## Outcome and increments

1. Enumerate all target books with stable caller identities and product-defined ordering. Load source for analysis even when no editor view has opened it. Report rejected/unreadable books explicitly.
2. Feed whole-book source to the composed host and obtain a complete initial publication. Do not call the project clean while only the current book has been analyzed.
3. On edits, update the touched book through Expediter's owning API and publish according to the selected synchronous contract. On removal, subtract its influence and invalidate related sites. Configuration changes rejudge according to upstream capabilities.
4. Expose readiness/current/stale/failure information to findings UI and telemetry. Keep last-known findings visibly stale when recomputation fails.

## Contract and failures

Pantry's retained target text is a copy of the last accepted input; CodeMirror remains canonical. No application splice protocol. The project must distinguish malformed-but-editable source from a book eligible for corpus registration. Duplicate parsed `\id` values cannot collide at the application ID seam.

Corpus judgment can change findings in untouched books, so a fresh publication replaces the applicable whole-project set. Pass-specific caches and `RETAIN_CHAPTERS` behavior must not become an incorrect app promise of universal chapter-only work.

## Useful proof

Use a tiny real corpus with a finding in an unopened book. Edit/remove another book so its corpus influence changes; assert current full publication and directory mapping. Include one rejected book and a same-length update. Do not repeat statistical rule calibration or multilingual stress corpora owned upstream.

## Open questions

What readiness does partially loaded or invalid input permit? Which passes ship first? How are source/reference roles introduced when supported upstream? If full update/publication exceeds the measured budget, isolate the cost before proposing scheduling/workers; any change to the synchronous posture needs explicit evidence and freshness semantics. See [29](v2-29-performance-and-memory.md).
