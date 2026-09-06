# 27 — STET comparison and navigation

Status: proposed parity slice. Prerequisites: [16](v2-16-readonly-surfaces.md), [21](v2-21-library-and-reference-resources.md), relevant engine addressing. Owns: STET's user workflow and imported data contract.

## Outcome and increments

1. Audit v1 STET input/catalog conventions and the actual read/compare/navigation job with a representative fixture. Carry standards/domain knowledge forward without porting the old screen architecture.
2. Present a read-only comparison/result view with explicit target/source identities and navigation to the canonical editor. Handle missing or mismatched anchors visibly.
3. Reuse existing filter/navigation/surface primitives where they fit. Keep STET-specific meaning in its own small adapter rather than flattening it into generic search semantics.
4. Consider editable target cards only after [17](v2-17-editable-satellites.md) and an explicit product choice. Editable STET is an opportunity, not a newly invented retirement requirement.

## Contract and failures

Reference data stays read-only. Results identify the source version they address and cannot authorize stale edits. Catalog parse failures, absent resources, and unsupported alignment must not silently produce an empty success view.

## Useful proof

One real catalog/data fixture proves parsing into the application boundary and target/reference navigation, including an unavailable anchor. One browser journey proves the preserved job. Use existing parser ownership for exhaustive syntax tests; avoid snapshotting the whole legacy STET screen.

## Open questions

Which current STET filters and comparison semantics are essential? How is differing versification represented? Is catalog refresh online, imported, or bundled? What does an unknown catalog version do? The first increment should produce a concrete before/after workflow proposal, not a guessed implementation from the acronym alone.
