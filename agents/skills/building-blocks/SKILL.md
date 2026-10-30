---
name: building-blocks
description: The dozen abstractions Sefer code is built on — the engine (galley), the one composition, the shell and its command registry, the Book and its edit API, the editor's structure, bundles, guards and host callbacks, the UI primitives, interface copy, observability, references, findings and storage — each with the file that already does it right and the smell of going around it. Read before writing a feature, a screen or an editor behaviour, and when reviewing one (the designer's branches especially); the question each entry answers is "what already does this?".
---

# Building blocks

Most code that has to be redone in review had the right idea and built it
from scratch, beside something that already did it. The usual case: a regex
over USFM to count verses, when the engine had already counted them
(`expectedVersesOf`, PR 11, replaced by galley's census). Before writing a
helper, find its row below and build on the file it names.

Each entry is: **the block**, where it is done right, and **the smell** that
means it is being gone around.

## 1. The engine knows the text: ask galley before reading USFM yourself

`src/core/galley/galley.ts` (`GalleyService`): `toc(id)` is the census (per
chapter: `number`, `anchors`, `lastVerse`; bridges counted to their end);
`skeleton(id)` is the block shape; `overlay`, `diff`, `merge`, `find`/`findAll`,
`mask`, `formatEdits`. A text is registered once (`update`, `updateReference`)
and then asked about by id. Done right: `src/app/ui/workspace/ReferencePane.tsx`
registers the reference and reads both its skeleton and its census
(`lastVerses` in `workspace/expectedVerses.ts`).

**Smell:** `matchAll(/\\v\s+(\d+)/)`, `/\\c\s+/` or any regex that walks a
whole book to find chapters, verses, paragraphs or notes. The engine handles
the cases the regex misses (a `\v` in a note, `\vp`, bridges, `\s5`). A regex over
one line you already found through the structure is fine.

## 2. Inside the editor, the structure: `structureAt(state)`

`packages/editor/src/core/model/docStructure.ts`: chapters, verses (with
`markerFrom`, `numFrom`, `numTo`, `contentFrom`), blocks and lines, built once
per document change from the engine's parse and memoised. `blockAt` in
`core/kernel.ts` finds the block at a position. Done right:
`versesAround` in `core/inputRules/verseNumbers.ts`.

**Smell:** `state.doc.toString()` plus a regex to find "the verse I'm in";
scanning lines backwards for a `\c`.

## 3. One composition, reached through context

`src/App.tsx` calls `composeApplication()` once (`src/app/services.ts`);
components get it with `useComposition()` (`src/app/CompositionContext.tsx`) or,
under the shell, `useServices()` (`src/app/ProjectContext.tsx`). Galley,
the filesystem, git, catalogue and observability all arrive this way.

**Smell:** a module that constructs its own service, imports a platform
layer (`#platform/...`) from a component, or passes a service down three
levels of props.

## 4. The shell holds app state; the command registry holds actions

`src/app/ProjectContext.tsx` (`useShell()`): the open project and book, mode,
panels, dialogs (`paletteOpen`, `importOpen`), reveal. `src/app/commands.ts`
(`registerCommand`): every action a person can take, with its `when`, so
the palette, menus and keys reach the same thing. Done right: the
`import.document` command opening `ImportDocumentDialog` via `setImportOpen`.

**Smell:** a button whose handler is the only way to do something; a
module-level `let` or signal that two screens share (there are a few, such
as `workspace/sidebarSlot.ts`; prefer the shell, and say why when not).

## 5. The Book is the text; change it with `apply`

`packages/text/src/book.ts`: `book.source()` gives `{ text, stamp }`;
`book.apply(changes, origin, judge)` is the only write, refused when stale or
when a rule says no. `trustedBy(origin)` is for edits the person previewed
whole (overlay, import), never to get past a rule. Previews are pure and
applied later against the stamp: `overlayBook`/`applyOverlay` in
`src/core/fixes/fixes.ts`, `previewImport`/`applyImport` in
`src/core/documentImport/importPreview.ts`.

**Smell:** building a new text and replacing the whole document; writing a
file to change scripture; a second undo stack.

## 6. One subscription per book, and read the stamp

`documentation/architecture/shell.md`: **one subscription per book, in
`src/app/ui/BookEditor.tsx`, and nowhere else.** It writes a stamp signal and
tells the shell `changed`; everything else reacts to that. Key a derivation
on the stamp (free to read, changes per revision), not on the text. Done
right: `ReferencePane.tsx`'s skeleton memo, "keyed on the STAMP and not the
text".

**Smell:** a second `book.changes(...)` in a component;
`createMemo(() => book.source().text)`; an effect that re-derives something
from the whole text on every keystroke.

## 7. Editor behaviour is a command bound to a key; its guards are the pipeline

`packages/editor/src/core/keymaps.ts` reads like VS Code's keymap: each bundle
owns commands by id (`edit.enter`, `verseNumber.accept`) and binds them to
keys as `{ key, command }`, by mode, preference and precedence. A host lays
its own bindings over the defaults (`userKeybindings`). A new gesture is a
command with an id and a default binding, so a person can rebind it later.
Transaction rules (what an edit may do) live in `core/guards/` and run in the
order `core/guards/pipeline.ts` gives. Editor-composed edits that the guards
would otherwise refuse carry `trusted.of("<name>")` (`core/kernel.ts`). This
is the editor's annotation, not the Book's `trustedBy`, and it marks an edit
the editor composed itself (`remark` in `core/commands/poetryLevels.ts`,
`setBlockMarker` in `core/guards/input.ts`).

**Smell:** a `keydown` listener on the DOM; an input handler that hard-codes
the key it waits for (`text === " "`); an untrusted edit to hidden markup in
Refine, which `refuseKeystrokesInsideHiddenMarkup` drops silently. That is
why `setBlockMarker` did nothing in Refine until PR 11.

## 8. Reuse the canonical command

Enter is `guardedEnter`, a line's kind is `setBlockMarker` or `turnLineInto`,
a verse is `insertVerse` (`core/commands/insert.ts`), verse edits are
`core/commands/verseCommands.ts`. A new gesture that also makes a line or a
verse runs the command and composes its transaction. Done right:
`written()` in `core/inputRules/typedMarker.ts` (Enter, then `setBlockMarker`,
dispatched as one step).

**Smell:** `` `\n\\${name} ` `` assembled by hand.

## 9. Host callbacks: a StateEffect out of core, listeners on the mount

Core emits a `StateEffect` (`activateMarkup`, `typedMarker`).
`packages/editor/src/bookEditor.ts` keeps a `WeakMap<EditorBook, Set<listener>>`
per callback and forwards from one `updateListener`; the mount exposes
`onX(listener) → detach`. Not a Facet: listeners arrive after mount.

**Smell:** a listener registry inside `core/`; a host reaching into
`view.state` for an event.

## 10. Text is shown in editor views, not redrawn

Anything that shows scripture (an excerpt, a preview, a reference, a diff
side) is an editor-backed view in a projection: `mountReader`, `mountCard`,
`mountReference` (`packages/editor/src/surfaces/`), or `ExcerptReader` in the
app. Done right: the import dialog's preview.

**Smell:** `innerHTML` or a `<p>` per verse built from USFM.

## 11. UI from the primitives, copy from Paraglide

`src/app/ui/primitives/`: Button, IconButton, Dialog, Popover, Menu, Select,
Switch, Tooltip, Table, VirtualList, Toaster (`toasts`), and the rest
(`index.ts`). `@corvu/*` only inside `primitives/`; a long list is a
`VirtualList`. Copy is a message: `m.<id>()` from `src/app/messages/en.json`
(`documentation/architecture/i18n.md`).

**Smell:** `<div role="button">`, a hand-rolled popover, an English string in
JSX, `font-size` in px.

## 12. Say what ran, and why it failed

`services.composition.observability.operation("area.verb", attrs)`, then
`.end("passed" | "failed", attrs)` around anything that loads, imports,
syncs or can fail. Done right: `reference.load` in `ReferencePane.tsx`,
`migrate.open` in `src/app/migrate.ts`. A failure reaches the person
as a toast whose words come from `describe(cause)` (`src/app/describe.ts`).
Inside the editor, a rule notes its verdict (`note`/`noteTr`,
`core/instrument/trace.ts`).

**Smell:** `console.log`; a `catch {}` that shows nothing; a toast saying
"Something went wrong".

## 13. References, findings and files have one shape each

- **A reference** a person types or a link carries is parsed by
  `parseCitation` (`packages/text/src/location/citation.ts`) and labelled
  by `addressLabel` (`location/address.ts`). Don't write a `/(\w+) (\d+):(\d+)/`.
- **A problem in the text** is a `Finding` (`src/core/findings/`), shown by
  the findings panel.
- **Bytes on disk** go through the `effect/FileSystem` port
  (`documentation/architecture/storage.md`), never OPFS, `node:fs` or Tauri
  directly.

## When none fits

Say so in the PR or the plan item: the new block, why the nearest one above
does not serve, and where it lives. Then add its row here.
