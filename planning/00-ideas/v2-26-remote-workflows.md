# 26 — Remote attachment and publication

Status: proposed, scoped by parity audit. Prerequisites: [20](v2-20-import-and-classification.md), [25](v2-25-git-lifecycle-and-history.md). Owns: approved online jobs and host credential boundaries.

## Outcome and increments

1. Inventory currently supported cloud/repository selection, attach/create/publish, fetch/push, and authentication jobs. Decide which block cutover; do not add providers merely because an SDK exists.
2. Represent import provenance separately from current remote attachment. A ZIP's origin does not grant credentials or authorize publication.
3. Implement one explicit remote operation with progress, typed offline/auth/conflict outcomes, operation tracing, and safe retry semantics. Keep local editing available offline.
4. Add source update notification only if promoted: opt-in check against immutable provenance, then explicit compare/adopt. No silent source replacement.

## Contract and failures

Credentials live behind host-appropriate storage/access, not in project files, logs, recovery, export, or editor state. Network operations never enter the synchronous editor frame. Partial clone/fetch/push or cancellation must reconcile repository state before subsequent mutation.

No general phone-home service is introduced for field diagnostics. Online product actions have a separate explicit policy from telemetry.

## Useful proof

Use real Git protocol behavior against a disposable loopback service when feasible. Test offline/rejected-auth/conflict outcomes through the actual operation boundary. Keep an opt-in real-provider contract check for important behavior that local fixtures cannot establish. Do not mock the entire network stack or make ordinary tests depend on external accounts.

## Open questions

Which hosts/providers are required? What secret persistence is appropriate on Web versus native? How are interrupted uploads and conflicting remote histories handled? Does current v1 behavior rely on native Git features unavailable in the shared candidate? Defer unsupported features explicitly for owner adjudication; do not silently declare remote work out of scope at retirement.
