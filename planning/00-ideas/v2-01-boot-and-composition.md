# 01 — Boot and dependency composition

Status: proposed. Prerequisites: current scaffold and [source review](v2-source-review.md). Owns: application boot and host composition, not editor semantics.

## Outcome and increments

1. Replace the demonstration route with one honest application entry that can report build identity, host kind, boot progress, and a recoverable boot error. Keep source/project ownership outside route components.
2. Pin the selected Solid/Effect/engine combinations when their first consumer is introduced. Confirm Solid 2 RC support from actual declarations and a small reactive lifecycle probe. Preserve pnpm and inspect existing scripts before adding commands.
3. Compose the first real storage/editor operation. Introduce a scoped Effect runtime for asynchronous services at that point, not a registry of hypothetical services. Give shutdown one owner.
4. Add the Tauri entry when the first native-disk slice needs it. Keep Web and desktop composition roots explicit while sharing domain behavior.

## Contract and failures

The router selects a screen; it does not own the only copy of an open project. Boot failures identify the failed capability without resetting or deleting stored projects. Unmounting a view releases that view's subscriptions and handles; closing a project releases project resources. A partially initialized engine cannot masquerade as ready.

## Useful proof

A small real boot/open/dispose probe should show no retained view subscription after repeated navigation and a clear initialization failure. Use one representative Web journey when source opening exists. Do not keep the counter test as a permanent gate or test every dependency's exports.

## Open questions and mistakes to avoid

Which boot work must finish before the first usable screen? Which work can load lazily? Are the router and Solid RC versions compatible with the chosen lifecycle integration? Do not solve this by adding Query, global stores, or runtime services without a named job. See [19](v2-19-shell-commands-and-localization.md) for the shell and [30](v2-30-release-and-cutover.md) for host packaging.
