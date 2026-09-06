# 31 — Project rename, delete, metadata, and export

Status: proposed parity slice. Prerequisites: [09](v2-09-platform-storage.md), [20](v2-20-import-and-classification.md), [21](v2-21-library-and-reference-resources.md). Owns: target project administration and portable output.

## Outcome and increments

1. Rename a target project without changing its stable identity or losing bound references. Define display-name versus filesystem-name behavior and refresh discovery correctly.
2. Edit the small set of supported project metadata through validated domain operations. Preserve unrelated metadata where the chosen format requires it; do not turn this into a universal schema form builder.
3. Export the target source and appropriate metadata in a supported portable format. Choose explicitly whether export captures current working text or saved bytes, and identify the snapshot consistently across books.
4. Implement project deletion with concrete scope and product-appropriate confirmation/recoverability. Close owned handles first and distinguish deleting an app catalog entry from deleting external user-owned files.

## Contract and failures

Standard target export excludes recovery, caches, diagnostics, UI state, bound reference bodies, and `.git` unless the chosen export is explicitly a repository. A portable full workspace bundle is a different deferred feature. Deleting a target must not remove a shared library source that another project uses.

Partial filesystem failures leave a truthful discoverable state and a bounded retry path. Renaming metadata does not authorize moving arbitrary native directories.

## Useful proof

Real temporary projects prove rename/reopen identity, export/reimport source and metadata, exclusion of internal files, and deletion scope with a shared reference. Include one interrupted/failed operation at the consequential boundary. Avoid testing a mocked file list against the same list used to implement export.

## Open questions

Which metadata fields actually matter to current users? What constitutes a consistent export while edits continue? Does deletion use a recoverable trash/quarantine path on each host? Which formats and provenance are mandatory? Keep these operational jobs visible at cutover even if they arrive after the editor's impressive features.
