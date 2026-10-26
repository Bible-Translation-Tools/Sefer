# Lint results

What the linters say about this commit, and every place we deliberately told one to look away. Green everywhere is the aim; a tool as broad as fallow, or a lint plugin written for Solid 1, will not always get there, so what is left is written down rather than left to be rediscovered.

The **numbers and inventory below the marker are generated** by `pnpm lint:results`, and the pre-commit hook regenerates and stages this file, so it describes the commit it is in. The prose above the marker is written by a person and says _why_: update it when a new class of exception appears or one is resolved.

## What is gated, and where

| check                                                     | command                                            | blocks                                                                                             |
| --------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| TypeScript                                                | `pnpm typecheck`                                   | every commit (lefthook), `pnpm check`, CI                                                          |
| Oxlint errors                                             | `pnpm lint`                                        | every commit, `pnpm check`, CI. Warnings never block.                                              |
| Formatting                                                | `pnpm format:check`                                | every commit, `pnpm check`, CI                                                                     |
| Boundaries                                                | `pnpm boundaries`                                  | every commit, `pnpm check`, CI ([boundaries](architecture/boundaries.md))                          |
| Unused files, exports, types, dependencies; import cycles | `pnpm deadcode` (fallow)                           | every deploy (`release.yml` `verify`); **advisory** on branches (`check.yml` reports, never fails) |
| Duplication, health, similar code                         | `pnpm exec fallow dupes \| health \| similar-code` | nothing — run by hand before a cleanup                                                             |

## Keeping this true

The generated half looks after itself; the judgement half does not. When a gate runs:

1. **A gate fails.** Fix the finding. If it genuinely should stand, suppress it _at the site_ with the reason in the comment (`// fallow-ignore-next-line unused-export -- <why>`, `// oxlint-disable-next-line <rule> -- <why>`), never with a file- or config-wide switch when a line will do. The reason is what appears in the table below, so write it for a reader who was not there.
2. **A new kind of exception appears** — a rule not listed under "Accepted exceptions", a new config ignore, a warning class nobody has looked at — add a paragraph there saying what it is and why it is accepted, or list it under "still to do".
3. **An exception is resolved** — the warnings are fixed, a suppression is deleted, a stub is wired — delete its paragraph. A stale reason is worse than none.
4. **Commit.** The pre-commit hook regenerates the inventory and stages this file. A commit made with `--no-verify` skips it; run `pnpm lint:results` before the next one, or the next ordinary commit will catch up.

`pnpm lint:results --check` says whether the inventory is stale without writing.

## Accepted exceptions, and why

**`solid/reactivity` suppressions.** `eslint-plugin-solid` 0.18 cleared the false positives 0.17 raised, and the real reads were rewritten (`FindProject`'s sort, `Resizable`'s one-time bounds, now under `untrack`). What is left is one gap in the rule: it treats a timer's callback as a place that may read a signal's current value once, and does not treat a promise continuation (`.then`, `.finally`, an `async` callback) the same way. Each such site carries `oxlint-disable-next-line solid/reactivity -- <reason>`. If the plugin learns continuations, delete them. `pnpm lint` fails on any warning, so a new one cannot pile up unseen.

**fallow `ignore` comments.** Each says why in the comment itself (listed below): a deliberate stub, a test contract registered nowhere on purpose, and the editor test harness kept for the tests that return once behaviour locks.

**fallow config exceptions.** Entries fallow cannot find by itself (the Solid plugin's convention files, a shim loaded through a Vite alias) and dependencies used outside any import (a CLI spawned as a binary, a plugin the Vite plugin loads, a Tauri binding ahead of its screen). Reasons are beside each in `.fallowrc.jsonc`.

**Duplication (~1.9%).** Mostly the dev playground's two experiments and the standalone tool scripts, where a few duplicated lines are cheaper than a shared module. Product-code duplication worth extracting is tracked in the component-size work, not here.

**The engine's overlay is not idempotent.** Re-running an Overlay adds a blank line inside a `\q1` block it inserted. It is the engine's door (`Fixes.overlayBook`), so it is an ask for the Galley maintainer, not a lint result; recorded here so it is not rediscovered.

<!-- lint-results:begin (generated by `pnpm lint:results`; do not edit by hand) -->

### Numbers

| check | result | gate |
| --- | --- | --- |
| oxlint errors | 0 | `pnpm lint`, every commit |
| oxlint warnings | 0 | `pnpm lint` fails on any, every commit |
| fallow dead code (`pnpm deadcode`) | 0 issue(s) | every deploy; advisory on branches |
| fallow duplication | 1.6% in 60 clone group(s) | none — advisory |
| suppression comments | 79 | each listed below with its reason |

### Oxlint warnings, by rule and file

None.

### Suppression comments

| file | suppresses | says |
| --- | --- | --- |
| `src/app/composition.ts` | `oxlint-disable-next-line` | no-console |
| `src/app/locale.ts` | `oxlint-disable-next-line` | solid/reactivity |
| `src/app/paraglide/messages.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/_index.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/landing_clone_from_link.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/landing_clone_repository.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/landing_drop_hint.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/landing_drop_not_project.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/landing_drop_one.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/landing_import_folder_short.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/landing_import_writer_short.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/landing_import_zip_short.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/landing_repos_consolidated.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/landing_repos_label.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/landing_repos_writer.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/landing_resize_columns.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/landing_search_or_link.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_active.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_bibles_offered.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_cancel.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_choose_language.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_download_cancel.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_download_named.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_download_starting.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_download_title.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_download.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_downloading_named.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_downloading.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_getting.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_held_by.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_language.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_list_loading.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_material.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_no_language.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_none_yet.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_remove_notes.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_resource.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_search_placeholder.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_shelf_bibles.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_shelf_notes.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_shelf_projects.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/reference_showing.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/refine_editor_label.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/refine_hide_reference.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/refine_resize_reference.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/refine_show_reference.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/settings_language_automatic.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/sidebar_hide_books.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/sidebar_hide_changes.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/sidebar_hide_history.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/sidebar_hide_key_terms.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/sidebar_hide_results.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/sidebar_hide_suggestions.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/sidebar_new_testament.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/sidebar_old_testament.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/sidebar_project_label.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/sidebar_search_label.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/sidebar_search_placeholder.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/sidebar_show_books.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/sidebar_show_changes.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/sidebar_show_history.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/sidebar_show_key_terms.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/sidebar_show_results.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/sidebar_show_suggestions.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/writer_languages_loading.js` | `eslint-disable` | — |
| `src/app/paraglide/messages/writer_languages_placeholder.js` | `eslint-disable` | — |
| `src/app/paraglide/registry.js` | `eslint-disable` | — |
| `src/app/paraglide/runtime.js` | `eslint-disable` | — |
| `src/app/paraglide/server.js` | `eslint-disable` | — |
| `src/app/ProjectContext.tsx` | `oxlint-disable-next-line` | solid/reactivity |
| `src/app/ui/cloud/SharedProjectCard.tsx` | `oxlint-disable-next-line` | solid/reactivity |
| `src/app/ui/cloud/SharedProjectCard.tsx` | `oxlint-disable-next-line` | solid/reactivity |
| `src/app/ui/workspace/BackToEditor.tsx` | `fallow-ignore-next-line` | unused-export |
| `src/app/ui/workspace/ReferenceColumn.tsx` | `oxlint-disable-next-line` | solid/reactivity |
| `src/app/ui/workspace/ReferenceColumn.tsx` | `oxlint-disable-next-line` | solid/reactivity |
| `src/app/ui/workspace/ReferenceColumn.tsx` | `oxlint-disable-next-line` | solid/reactivity |
| `src/app/ui/workspace/ReferenceColumn.tsx` | `oxlint-disable-next-line` | solid/reactivity |
| `src/app/workflows/drafting.ts` | `fallow-ignore-file` | unused-file |
| `src/core/git/contract.ts` | `fallow-ignore-file` | unused-file |

### Fallow configuration exceptions

From `.fallowrc.jsonc`, where each one's reason is written beside it.

- **Extra entries:** `src/App.tsx`, `src/Document.tsx`, `tools/vite/lucideSolidShim.ts`, `e2e-desktop/wdio.conf.ts`, `e2e-desktop/**/*.desktop.ts`, `packages/editor/bench/vite.config.ts`, `packages/editor/bench/main.ts`
- **Dependencies it cannot see used:** `@inlang/plugin-icu1`, `@tauri-apps/cli`, `@solidjs/diagnostics`, `@tauri-apps/plugin-opener`, `@wdio/cli`, `@wdio/local-runner`, `@wdio/mocha-framework`, `@wdio/spec-reporter`, `@wdio/tauri-service`

<!-- lint-results:end -->
