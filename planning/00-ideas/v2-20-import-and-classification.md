# 20 — Import and resource classification

Status: proposed. Prerequisites: [09](v2-09-platform-storage.md), [04](v2-04-source-and-book-lifetime.md). Owns: validated staged import and provenance.

## Outcome and increments

1. Open/import one local folder or ZIP containing supported scripture and metadata. Classify semantic kind, physical format, and intended role separately. Preserve source bytes until the explicit normalization/repair boundary.
2. Carry Resource Container/Scripture Burrito knowledge forward selectively from v1, after identifying the supported forms. Respect metadata ordering, then numeric filenames, recognized canonical fallback, then deterministic unknown handling with a diagnostic.
3. Stage validation before publishing a project into the library. Detect conflicting identities, missing files, unsupported formats, and unsafe archive paths. A failed import leaves an inspectable error and no half-registered project.
4. Add repository/cloud import through [26](v2-26-remote-workflows.md) without conflating import origin with a current remote attachment.

## Contract and failures

A blessed source import is read-only in its binding role. Deliberate target creation from an eligible resource is a separate action. File extension alone cannot decide semantic renderer or writable authority. Duplicate USFM book designators must not silently overwrite files or collapse IDs.

## Useful proof

Small real folder/archive fixtures cover a valid supported container, ordering, duplicate identity, malformed UTF-8, and traversal rejection. Reopen the staged result through the production repository boundary. Do not copy every parser/standards fixture from upstream or build a generic archive framework.

## Open questions

Which exact RC/Burrito versions and import providers are required at cutover? How much metadata is preserved verbatim versus rewritten? Is import copy-in or an external-folder binding? What recovery is needed after a process dies during staged import? Export and project administration are [31](v2-31-project-management-and-export.md).
