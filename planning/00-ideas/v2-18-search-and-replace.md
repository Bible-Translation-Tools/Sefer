# 18 — Project find and one-match replacement

Status: proposed. Prerequisites: [03](v2-03-engine-consumer-boundary.md), [13](v2-13-project-analysis.md), [16](v2-16-readonly-surfaces.md). Editing cards additionally require [17](v2-17-editable-satellites.md). Owns: query/results interaction and safe replacement.

## Outcome and increments

1. Search all target books, including unopened books, with a small explicit scope model: source text versus the selected engine text projection. Preserve book ordering and source-bound result addresses.
2. Navigate from a result to the canonical editor, with correct visible anchoring and source-mode fallback when required.
3. Replace one selected current result through [06](v2-06-transactions-and-undo.md), then refresh result identity. Refuse stale matches rather than applying an old offset after another edit.
4. Consider editable result cards only after their synchronization gate and a demonstrated user benefit.

## Contract and failures

Onion owns USFM projection/mask semantics. The application must not strip markup with its own regex to manufacture search coordinates. A projected match can cross excluded markup: navigation may use an envelope, replacement needs safe segment semantics or refusal. Read-only references cannot acquire target write authority through search.

No project-wide Replace All in initial scope. Per-book/current find-replace jobs from v1 still need explicit disposition; rejecting global replacement does not remove those jobs.

## Useful proof

A tiny real multi-book fixture covers an unopened hit, non-ASCII offsets, removed-markup boundaries, and stale one-match refusal. A single browser journey proves query → result → canonical navigation → replacement → Undo. Avoid retesting the search library's entire regex semantics.

## Open questions

Which literal/regex/case/diacritic options are actual parity requirements? Should replacement across projected gaps be disabled initially? How are incomplete project loads represented? What is the cancellation policy for a superseded query? Add an index or worker only after measured query latency justifies it.
