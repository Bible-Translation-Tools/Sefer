# 10 — Save receipts and external changes

Status: proposed, data-safety gate. Prerequisites: [04](v2-04-source-and-book-lifetime.md), [06](v2-06-transactions-and-undo.md), [09](v2-09-platform-storage.md). Owns: persisted baseline and save coordination.

## Outcome and increments

1. Capture immutable source revision R and its canonical checksum, serialize the remembered disk style, and save that snapshot. Return a receipt for the bytes/revision actually written.
2. Keep newer edits dirty if R+1 arrives during the write. Serialize or otherwise coordinate writes so an older completion cannot overwrite newer durable source. Do not use “latest editor state” inside an awaited save continuation.
3. Compare external disk identity with the loaded/saved baseline before overwrite. Re-read/reconcile conflicting changes. Canonically equal newline-only external changes can update disk identity/style without a false content conflict.
4. Surface save progress/failure and integrate keyboard save. Git checkpoint success and recovery cleanup remain separate outcomes.

## Contract and failures

The saved baseline advances only from an accepted receipt. A write failure leaves working source intact and dirty. A pre-write external check has a check/write race: choose a supported locking/conditional replacement protocol or explicitly state that residual limitation, rather than claiming atomic compare-and-swap from ordinary filesystem calls.

Use distinct canonical and disk checksum brands with an identified algorithm. Do not reuse a differently defined parser checksum because both are numeric.

## Useful proof

Real bytes prove serialization and reopen. One controlled overlapping-save test proves newer edits stay dirty and older writes cannot win. One external-change test proves refusal/reconciliation. Assert saved bytes and baseline identity, not a sequence of filesystem mock calls.

## Open questions

How does explicit save interact with autosave? Which external-editor concurrency guarantee is required? How are multi-file saves reported if only some succeed? What policy adopts external newline changes while an edit is dirty? See [11](v2-11-recovery.md), [25](v2-25-git-lifecycle-and-history.md), and [28](v2-28-multi-book-operations.md).
