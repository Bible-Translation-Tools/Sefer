# 15 — Programmatic fixes and formatting

Status: proposed. Prerequisites: [06](v2-06-transactions-and-undo.md), [14](v2-14-findings.md). Owns: safe application of engine-produced edits; Onion owns USFM transformations.

## Outcome and increments

1. Offer one engine fix with an expected source revision and exact mapped raw edit spans. Preview when the transformation warrants it, then submit through the canonical funnel.
2. Add whole-book formatting as one intentional Undo unit. Show resulting dirty state and support saved comparison.
3. Add chapter/range formatting using the upstream operation's declared scope semantics. Confirm how insertions at boundaries and whole-claim edits are admitted; do not clip raw edits blindly.
4. Extend to selected multi-book operations only after [28](v2-28-multi-book-operations.md). Match Formatting remains the separate product investigation in [22](v2-22-drafting-and-structured-workflows.md).

## Contract and failures

Refuse or recompute stale actions before changing source. A projected finding crossing removed markup requires exact editable segments or an explicit upstream fix/refusal. Never replace its enclosing navigation envelope as if it were contiguous text. A fix must not bypass a surface's target/write authority merely because it is programmatic.

Invalid or partially applicable edits fail with source unchanged for the affected atomic operation. Formatting does not silently save, create Git history, or discard recovery.

## Useful proof

Use actual engine output for one fix and one format operation. Assert exact resulting bytes, protected boundary behavior, stale refusal, and a single Undo restoration. Include non-ASCII offsets and one discontinuous projection case. Exhaustive format/lint correctness remains upstream.

## Open questions

Which fixes are safe without preview? Does range formatting claim enclosing structures or refuse? What fallback appears when a detector can locate but not safely edit? What user feedback distinguishes no-op from failure? Avoid implementing a second JS formatter or adding a generic command language before concrete fixes need it.
