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
| fallow duplication | 1.8% in 47 clone group(s) | none — advisory |
| suppression comments | 11 | each listed below with its reason |

### Oxlint warnings, by rule and file

None.

### Suppression comments

| file | suppresses | says |
| --- | --- | --- |
| `src/app/composition.ts` | `oxlint-disable-next-line` | no-console -- the telemetry bridge itself failed; the ring cannot report on its own exporter |
| `src/app/ProjectContext.tsx` | `oxlint-disable-next-line` | solid/reactivity -- runs once, when composition settles, under the component's owner |
| `src/app/ui/cloud/CloudScreen.tsx` | `oxlint-disable-next-line` | solid/reactivity -- a promise continuation: reads the query once, when the transfer settles |
| `src/app/ui/CloudPanel.tsx` | `oxlint-disable-next-line` | solid/reactivity -- the account's work: runs once per press, reading the field at the moment of the ask |
| `src/app/ui/review/ReviewPanel.tsx` | `oxlint-disable-next-line` | solid/reactivity -- a promise continuation: runs once, when Apply settles |
| `src/app/ui/workspace/ReferenceColumn.tsx` | `oxlint-disable-next-line` | solid/reactivity -- a promise continuation: runs once, when the bindings resolve |
| `src/app/workflows/drafting.ts` | `fallow-ignore-file` | unused-file -- a deliberate stub; see the note below for why it is not wired. |
| `src/core/git/contract.ts` | `fallow-ignore-file` | unused-file -- registered nowhere on purpose; see the note below. |
| `src/editor/core/instrument.ts` | `oxlint-disable-next-line` | no-console -- no ring is registered: a standalone editor still says it broke |
| `src/editor/testing/harness.ts` | `fallow-ignore-file` | unused-export unused-type -- the editor tests that use these come back once behaviour locks. |
| `src/editor/testing/mount.ts` | `fallow-ignore-file` | unused-file -- kept for the browser-mode editor tests that will want it. |

### Fallow configuration exceptions

From `.fallowrc.jsonc`, where each one's reason is written beside it.

- **Extra entries:** `src/App.tsx`, `src/Document.tsx`, `tools/vite/lucideSolidShim.ts`
- **Dependencies it cannot see used:** `@tauri-apps/cli`, `@solidjs/diagnostics`, `@tauri-apps/plugin-opener`

<!-- lint-results:end -->
