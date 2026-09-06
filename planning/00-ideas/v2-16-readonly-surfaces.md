# 16 — Read-only surfaces and lifetime

Status: proposed. Prerequisites: [06](v2-06-transactions-and-undo.md), [07](v2-07-visual-and-chapter-views.md). Owns: source/reference/result/comparison viewing and disposal.

## Outcome and increments

1. Mount a second view for a real read-only job: source scripture, saved comparison, or a search excerpt. Give it local selection/scroll and an explicit readable source identity.
2. Enforce read-only authority at command and mutation boundaries, not only by hiding toolbar buttons. Copy/navigation remains useful.
3. Reuse canonical structure when a same-source surface is eligible. The donor now borrows structure with an exact-source guard; do not analyze the whole book independently for every card.
4. Add clear mount/unmount/dispose ownership and bounded visible result views. External reference text has its own read-only source identity and cannot borrow unrelated target products.

## Contract and failures

A view is not another writable source. Closing a surface releases its subscriptions/handles without closing the canonical book. Removed or changed sources invalidate the view explicitly. Missing resources remain missing rather than silently substituted.

## Useful proof

A real browser proves copy/selection, no mutation through typing/paste/commands, and stable target history while a reference is mounted. Repeated mount/unmount with actual handles/subscriptions detects leakage. One measurement verifies several same-source cards do not cause per-card full analysis.

## Open questions

Which views need full CodeMirror versus simpler semantic rendering? How many live views are useful before measured virtualization? Can the initial comparison use two read-only panes plus the ordinary editor? Avoid a generalized docking/workspace framework and do not make every read-only card a miniature document protocol. Editable surfaces require [17](v2-17-editable-satellites.md).
