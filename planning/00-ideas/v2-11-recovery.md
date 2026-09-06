# 11 — Crash recovery and restore

Status: proposed, data-safety gate. Prerequisites: [09](v2-09-platform-storage.md), [10](v2-10-save-and-external-change.md). Owns: unsaved-work durability, independent of Git and diagnostics.

## Outcome and increments

1. Persist a canonical whole-book recovery snapshot with revision, baseline identity, serialization policy, and schema version. Schedule asynchronously outside the editor frame, coalescing obsolete pending snapshots.
2. On reopen, compare recovery, saved baseline, and current disk. Offer the appropriate recovery/conflict choice; do not blindly replay a snapshot over an external edit.
3. Remove or supersede recovery only when a save receipt covers that snapshot. An earlier save completion must not delete recovery of newer edits.
4. Define retention, quota response, partial/corrupt snapshot handling, and bounded close behavior. Close may flush, but crash recovery cannot depend on a graceful shutdown callback.

## Contract and failures

Recovery failure must be visible because it changes the user's risk, while preserving the live editor. Recovery is not a log, a Git commit, a derived-analysis cache, or normal export content. Save and recovery have separate lifecycles and independently attributable failures.

Interrupted writes must leave either a valid prior snapshot or a detectable incomplete candidate according to the host guarantee. Never silently discard the only recoverable bytes because a schema is unfamiliar.

## Useful proof

One real process/profile restart restores unsaved text; one save-during-recovery race protects a newer revision; one truncated snapshot remains recoverable or clearly rejected without overwriting source. Use isolated application-data roots. Kill/restart tests belong to a slower targeted tier, not every utility test.

## Open questions

What maximum unsaved-work interval is acceptable? Per-book versus project recovery manifest? How many prior snapshots are useful, and under what size cap? Is a recovery conflict compared using the same [diff surface](v2-23-diff-and-revert.md)? Specify a product policy rather than accumulating a configurable backup framework.
