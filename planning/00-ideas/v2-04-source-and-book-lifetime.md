# 04 — Source ingestion and book lifetime

Status: proposed. Prerequisites: [01](v2-01-boot-and-composition.md), [03](v2-03-engine-consumer-boundary.md); disk ingestion joins [09](v2-09-platform-storage.md). Owns: canonical source, source identities, and application book lifetime.

## Outcome and increments

1. Decode a supported file without silently replacing invalid UTF-8. Normalize CRLF/CR to LF, remember disk serialization style, and retain separate disk/canonical identities.
2. Create one canonical whole-book CodeMirror state and history when editing needs it. Keep that state across mode/chapter changes. Project discovery and analysis do not require a mounted view for every book.
3. Define open/close ownership: project owns book lifetime, mounted surfaces own view subscriptions, engine retains only its declared analysis inputs/products. Failed opens leave existing books usable.
4. Add explicit invalid-byte repair: preserve original bytes, show safe context, permit untouched export or deliberate correction before a normal editor state exists.

## Contract and failures

For uniform newlines, preserve the loaded output style. For mixed input, project policy wins, otherwise dominant style with LF as the tie. New files use project policy or LF, not host OS defaults. Paste normalizes newlines at ingress.

A caller book ID is independent of the parsed USFM `\id`; duplicate or changed designators must not overwrite another book's session. Missing `\id` can remain repairable source even if Pantry rejects it for corpus registration. Removal/rejection must not leave stale engine findings looking current.

## Useful proof

A compact matrix proves canonical equality versus disk serialization, invalid-byte preservation, and mode switches retaining Undo. Include one same-length edit to defeat length-as-identity bugs. Lifecycle verification should inspect actual resource cleanup and book state, not count framework hook calls.

## Open questions

When can inactive canonical states be evicted without losing history or dirty work? How are source-only/unregistered books presented? Where is the remembered output style persisted across recovery? Do not introduce session objects in editor core solely to unify demos; application lifetime belongs here. See [10](v2-10-save-and-external-change.md) and [11](v2-11-recovery.md).
