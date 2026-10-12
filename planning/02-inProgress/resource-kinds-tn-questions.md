# Resource kinds, TN proof: questions for Will

**Status:** open, 2026-10-12. Written while building the Translation Notes proof unattended (plan: `planning/01-discussing/resource-kinds-2026-10-01.md`, "Built so far"). Each entry: the question, the options, what was chosen for now and why, and how hard it is to change. Every choice taken is the conservative, reversible one; none is load-bearing enough to have stopped for.

## 1. Where the notes show

The reference column shows one text at a time (your 2026-10-08 ruling). Notes could be (a) one more choice in the same "Reference language" menu, replacing the scripture pane while chosen, or (b) a second section under the scripture pane, both at once.

**Chosen: (a).** No layout change, and the menu already had "Reference material" as a heading in its ordering. The cost is that reading the ULB and its notes together means switching. **To change:** small — the renderer registry hands back a pane for any resource; the column would render two `ResourcePane`s. The design question (does a notes section break the "quiet workspace") is yours or the designer's.

## 2. The last chunk of a chapter

A chunk file's range closes at the next sibling (convention). The last chunk of a chapter runs "to the chapter's end", which needs a verse count, which is versification (plan §11.1).

**Chosen:** the handle borrows the open project's table of contents (`PlaceContext.versesIn`, `src/app/kinds/context.ts`). Without one — a book the project does not hold — the note's Address is its first verse and it is marked `openEnded`, and the pane says "From Romans 1:32 to the chapter's end". Asking "notes for verse 33" still finds it: covering a verse needs no count. **To change:** medium, and it waits on §11.1: a real versification table replaces `borrowedContext` in one place.

## 3. Chapter and book introductions

`01/intro.md` and `front/intro.md` are notes with an Address of the chapter (`GEN 1`) or the book's introduction (`GEN intro`).

**Chosen:** they answer only when the reader stands at the chapter's head or the book's introduction, not beside every verse of the chapter, which would put a page of introduction above every verse's notes. **To change:** trivial (`answersPlace` in `src/core/resources/kinds/tn/note.ts`). Whether intros want their own affordance ("Chapter 1 introduction" link at the top of the pane) is a UX question.

## 4. Where `en_tn` comes from

The Language API's view has no rows for the helps (plan §6, "Catalogue gap").

**Chosen:** a second source, stated once: `HELP_TEXTS` in `src/app/catalogue.ts` lists `WycliffeAssociates/en_tn` on the configured content host, and the column offers it under "Reference material (n)" until it is on the device. **To change:** trivial to add rows; replacing it with API rows is a small change once the API has them. The content-host-relative URL means the dev channel's WACS dev host would need its own copy of `en_tn` (it may not have one; untested there).

## 5. Where the packs live, and when they are stale

**Chosen:** `<resource root>/.sefer/packs/tn/<BOOK>.json`. On desktop that is inside the clone, which `remote/clone.ts` already excludes from git (`.git/info/exclude`), so the working tree stays upstream's. A pack built from a raw tree is stamped with a fingerprint of the book directory's listing (path, size, mtime per file) and rebuilt when it moves; a root that holds no raw tree (the Web) treats its packs as the resource, stamped with the import time and the commit cloned. **To change:** medium (`src/core/resources/kinds/tn/pack.ts` only). The fingerprint is a change detector, not a content hash, and would miss a same-size edit inside one mtime tick — fine for read-only, worth revisiting for editable TN.

## 6. Keeping `en_tn` current on the Web

A packed-only root has no `.git`, so the plan's "realistic first ask" (a fast-forward pull of `en_tn`) is, on the Web, a re-download and re-pack (11.6 s measured, below). There is no "a newer en_tn is available" check yet. **Options:** probe the remote's HEAD against the stamped commit (cheap; `Remote.probe` exists) and re-pack; or publish per-book packs as a Gitea release (plan §5, the content-team ask). **Chosen:** nothing yet. **To change:** small for the probe.

## 7. What `recognize` refuses

**Chosen:** an RC of type `help` with identifier `tn` and format `text/markdown` is TN; `tn` in another format (unfoldingWord's TSV), `tq`, `tw`, and RC types it does not know are refused with a sentence (`Unsupported`); an RC that declares no type, or `book`/`bundle`, is scripture, as every RC was before kinds (refusing those would empty reference columns that work). A Burrito is scripture only for flavour `textTranslation`. Library rows written before kinds are recognised again from their metadata on load; a row that is now refused is left out of the list (telemetry `library.load declined`), its files untouched. **To change:** trivial (`src/core/resources/kinds/content.ts`).

## 8. Files the reader does not read

`NN/index.md` (48 files in `en_tn`, each a chapter's translationWords links), `title.md`, anything in `front/` but `intro.md`, and any name that is not the layout's are listed in the pack's `skipped`, never guessed at. Two files claiming one place (`1.md` and `01.md`) refuse the book. **To change:** trivial. `index.md` is TW's verse links and may matter when TW arrives.

## 9. Find over notes

**Chosen:** one switch per project, "Search Translation Notes" (it names every picked resource whose handle has a haystack), scope `helps` in the URL. It searches the project's books only, since a hit is shown as your verse's card with the note beside it; hits on intro notes have no verse card and are counted in the gap ("14 in Translation Notes" above "1/1"). The note beside the card is its exact Markdown as plain text, the match marked; it is not rendered. **To change:** small. A per-resource scope, and rendering the pair, are both easy once wanted.

## 10. "Exact" bodies, and line endings

Notes are cut from the text exactly where the parser's headings start, and a file's notes concatenate back to the file. The text is first decoded the one way Sefer decodes anything (`core/source/source.ts`: strict UTF-8, BOM dropped, CRLF to LF). So "exact" is exact against canonical text, not against the original bytes. **To change:** only matters for editable TN, where Book already writes back the dominant EOL/BOM.

## 11. The role a TN pick takes

**Chosen:** `tn` (`ROLES.translationNotes`, which already existed and nothing read), not `notes`. It is persisted in the project's `.sefer/project.json` picks. **To change:** trivial in code (`src/app/kinds/table.ts`), but picks already written would keep the old role.

## 12. Notes follow the caret, not the scroll

`shell.place` is the caret's Address. Scrolling the editor without moving the caret does not move the notes. **Options:** feed the aligned group's anchor into `place` too. **Chosen:** caret only, which is the "verse the editor is on" in the narrowest sense. **To change:** small.

## 13. Local folder or zip of TN

Desktop: `Library.add(folder)` recognises and indexes a picked folder in place (untested in the app — no desktop run was made). The Web has no UI to add a picked folder or zip of TN; the path exists (`packHelp` from a memory FileSystem, as Writer's `pickLocal` stages a zip in memory) but is not wired to a button. **To change:** small; where the button goes is a UX question.

## Interface findings (from walking Macula and TW through the interfaces)

These are places where an interface will have to change for the next kind; recorded rather than built, because building them now would be shaping the interface around kinds not yet authorized.

- **Opening with progress.** Macula's `openCorpus` reports download progress (44 MB Hebrew); `KindRow.open` has no progress channel. When Macula is built, `open` gains an optional `onProgress` (or returns a progress stream beside the Effect). Additive.
- **What `open` is given.** Rows get `(fileSystem, resource)`. Macula's row needs a fetch and a wasm URL; it would close over its platform module (`src/platform/web/macula.ts`), which the table may import since it lives in `src/app`. If that proves awkward, `open` takes `Services`. Additive.
- **A kind's own search.** Macula's faceted find is not a haystack. `ResourceHandle` has no slot for it yet; when built it is an optional slot (e.g. `query`) and a search panel in the renderer registry, and Find gains that panel beside the text find (plan §9). Additive; `documents` stays the default.
- **Below the verse.** Macula's entries are a verse's words, so `Places.at(verse)` carries them; aligned-word highlighting would need a finer answer than Address (plan §11.2). Not forced by anything built.
- **Dictionary hits.** TW's documents have many Addresses each; Find's join would make one card per occurrence verse, which may be too many. A kind-supplied hit card in the panel (plan §9's "the kind's own hit cards") would be the fix. Not built.
