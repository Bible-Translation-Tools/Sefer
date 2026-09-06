# 06 — One canonical transaction funnel

Status: proposed. Prerequisites: [04](v2-04-source-and-book-lifetime.md), [05](v2-05-editor-donor-and-policy.md). Owns: content mutations and shared history.

## Outcome and increments

1. Submit a real change with source revision, origin, selection intent, and surface capability. Check freshness and admission before mutating canonical state.
2. Apply donor mutation phases in explicit order, settle selection, update required structure, and publish one consistent accepted result. Observe rejected and rewritten attempts as well as successful commits.
3. Fan accepted changes synchronously to mounted surfaces before callbacks see the result. Reentrant submissions queue only across the current dispatch and must revalidate against the new revision. No asynchronous queue of stale editor changes.
4. Route formatting, replacements, fixes, and later satellites through the same boundary. Keep selection-only actions from manufacturing content revisions or dirty state.

## Contract and failures

A user gesture has the intended Undo grouping. Independent surfaces cannot acquire independent canonical content histories. Selection mapping uses the accepted change, including policy rewrites. A refusal returns a meaningful reason and leaves source unchanged.

Ordinary Undo preserves chronology. After project operation P then user edit U, Undo yields the post-P state. Selectively undoing P beneath U is a separately designed revert operation, never an overloaded Undo command.

## Useful proof

Real CodeMirror states protect stale-revision refusal, a rewritten edit, reentrant callback ordering, same-length edits, and one-gesture Undo. Add phase-order tests only when swapping phases changes observable behavior. Test instrumentation with structured outcomes rather than a mock dispatch call count.

## Open questions

Which selection travels with a programmatic operation? What happens if post-commit analysis fails: retain canonical text and mark projections unavailable rather than rolling back behind history? Which donor trust annotations require narrower Sefer capabilities? See [12](v2-12-observability.md), [17](v2-17-editable-satellites.md), and [28](v2-28-multi-book-operations.md).
