# 28 — Multi-book operations without another history system

Status: proposed. Prerequisites: [06](v2-06-transactions-and-undo.md), [13](v2-13-project-analysis.md); saving adds [10](v2-10-save-and-external-change.md). Owns: coordinated application commands across books.

## Outcome and increments

1. Select one real job, such as project formatting. Capture the participating source revisions and produce per-book proposed changes with a shared operation identity.
2. Validate applicability and write authority before applying. Choose explicitly between all-or-nothing in-memory application and clearly reported partial application; neither is implied by a loop of dispatch calls.
3. Apply through canonical book funnels, update project analysis coherently, and expose progress/outcomes. Source mutation and subsequent multi-file save remain separate phases.
4. Only if a real need exists, design “Revert project operation” with inverse changes, intervening edits, and conflict refusal. Ordinary Undo remains chronological within a book.

## Contract and failures

A stale participant cannot silently receive an old recipe. No trusted bulk-operation flag grants unrestricted edits. Operation IDs correlate evidence; they are not another source of text/history truth. A multi-file disk failure cannot be called atomic unless the storage protocol actually guarantees it.

Canonical mutation bursts stay bounded; long preparation/I/O can occur outside them with revision validation before application. Do not hide a long project loop inside one nominally synchronous editor gesture.

## Useful proof

Two real books, one intervening edit: verify the selected stale/partial policy and per-book Undo. A save failure in one book must report the exact durable outcome without lying about the others. Do not create an elaborate transaction manager before this first operation defines its requirements.

## Open questions

Which commands truly require all-or-nothing source application? How should the UI present partial saves? Is selective revert valuable enough to justify rebase/conflict machinery? How are unopened books instantiated without losing project identity? Project-wide Replace All remains excluded unless separately approved.
