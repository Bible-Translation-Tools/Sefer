# Resource kinds, TN proof: questions for Will

**Status:** refreshed 2026-10-12, after rounds 1 and 2 (Translation Notes read-only on the Web: Library, reference column, `/projects` Notes section, Find, progress, tutorial). Each open entry: the question, the options, what is chosen now, and the cost to change. Every choice taken was the conservative, reversible one. Settled and moot entries are kept short at the end, so a decision is not asked twice.

How to add the next kind is now its own chapter: [`documentation/architecture/resource-kinds.md`](../../documentation/architecture/resource-kinds.md). Provenance and the (unbuilt) update check: `documentation/architecture/resources.md`, "Provenance and updates".

## Open

### 1. Where the notes show, and remembering which text is shown

The reference column shows one text at a time (Will, 2026-10-08), so Translation Notes are one more choice in the "Reference language" menu and replace the scripture pane while chosen. Reading the ULB and its notes together means switching. Which text is SHOWN is a signal in the column, not saved: reopening a project shows the first entry (the declared scripture source) again, and the notes must be chosen again. The pick itself is saved.

**Options:** (a) as now; (b) remember the shown resource per project in `.sefer/project.json` beside `referencePicks`; (c) a notes section under the scripture pane, both at once. **Chosen:** (a). **Cost:** (b) small; (c) small in code (the registry hands back a pane for any resource, the column would render two `ResourcePane`s), but it is a design call about the quiet workspace.

### 2. The last chunk of a chapter (versification)

A chunk's range closes at the next sibling (convention, `closeAtNextSibling`); a chapter's last chunk runs to the chapter's end, which needs a verse count (plan §11.1).

**Chosen:** the handle borrows the open project's table of contents (`PlaceContext.versesIn`, `src/app/kinds/context.ts`). In a book the project does not hold, the note's Address is its first verse, marked `openEnded`, and the pane says "From Romans 1:32 to the chapter's end". Asking for verse 33 still finds it: covering a verse needs no count. **Cost:** medium, and waits on a tier-2 versification table, which replaces `borrowedContext` in one place.

### 3. Chapter and book introductions

**Chosen:** `NN/intro.md` and `front/intro.md` answer only at the chapter's head (`GEN 1`) or the book's introduction (`GEN intro`), not beside every verse. **Options:** also a "Chapter 1 introduction" link at the top of the pane. **Cost:** trivial (`answersPlace`, `src/core/resources/kinds/tn/note.ts`); the link is a UX question.

### 4. Where `en_tn` comes from

The Language API's view has no rows for the helps. **Chosen:** a second source stated once, `HELP_TEXTS` in `src/app/catalogue.ts`, offered in the reference column's menu and the `/projects` Notes section. Each row names its host (WA's `en_tn` on WACS production), as share links do, so every channel downloads the same notes (the dev channel's WACS dev holds an older copy) and a help never shares a Library folder across clouds (review finding 6, moot for helps since; source texts still key their folder by owner and repository only). **Cost:** trivial to add rows; small to switch to API rows once the API has them.

### 5. Packs: where, and the staleness stamp

**Chosen:** `<root>/.sefer/packs/tn/<BOOK>.json` (inside a clone, `.sefer/` is in git's exclude, so the working tree stays upstream's). With the raw tree present (desktop), a pack is stamped with a fingerprint of its book directory's listing (path, size, mtime) and rebuilt when that moves. Without it (the Web) the packs are the resource, stamped with the import time and the commit cloned. **Cost:** medium, one file (`pack.ts`). The fingerprint is a change detector, not a content hash: it could miss a same-size edit within one mtime tick. That does not matter while TN is read-only; revisit for editable TN.

### 6. Update check for a held copy

Nothing checks whether `en_tn` (or a held source text) has moved upstream. Everything needed is recorded: `Resource.upstream { url, commit }` in `library.json`, and on the Web the commit in every pack's stamp. How the check would work is written down in `resources.md`, "Provenance and updates". **Options:** a probe on project open beside `checkForChanges`; a button in the Notes section; both. **Chosen:** not built. **Cost:** small for the probe and the message; the Web re-pack is `referenceCopy` again into a fresh folder, then a swap.

### 7. Notes follow the caret, not the scroll

`shell.place` is the caret's Address; scrolling without moving the caret does not move the notes. **Options:** also feed the aligned group's anchor into `place`. **Chosen:** caret only. **Cost:** small.

### 8. Adding a local folder or zip of notes

Desktop: `Library.add(folder)` recognises and indexes a picked folder in place (not run in the app; no desktop run was made). The Web has no button; the path exists (`packHelp` reads any `UpstreamTree`, and a zip staged in the memory FileSystem, as Writer's `pickLocal` stages one, is a `treeInFolder`). **Cost:** small; where the button goes is a UX question.

### 9. Remove does not release an open handle

Remove on `/projects` forgets the Library row and deletes the folder (only inside the Library's own directory). A project open at the time keeps its handle until it closes (`shell.resources` releases on close), so its pane may still answer until then. **Cost:** small: release that one handle on remove.

### 10. A note beside a Find card shows raw Markdown

In "Search Translation Notes" the note beside your verse is its exact text, so a heading reads "# sons of God". It is plain on purpose, so the match can be marked. **Options:** render it and mark the match in the rendered text; or strip the heading's `#` for display. **Cost:** small. Also open: one switch for all searchable resources, not one per resource (easy when wanted).

## Settled or moot

- **What `recognize` refuses.** RC `help` + `tn` + `text/markdown` is TN; other formats of `tn`, `tq`, `tw` and unknown RC types are refused as "no reader yet" (`Unsupported`); an RC with no type, `book` or `bundle` is scripture; a Burrito is scripture only for flavour `textTranslation`. Old Library rows are recognised again on load; one now refused is left out of the list, its files untouched. Documented in the kinds guide. (Was question 7.)
- **Files the reader does not read.** `NN/index.md` (a chapter's TW links), `title.md`, other `front/` files and names outside the layout go in the pack's `skipped`; two files claiming one place refuse the book. `index.md` matters again only when TW is built. (Was 8.)
- **"Exact" bodies.** Exact against canonical text (strict UTF-8, BOM dropped, CRLF to LF), not the original bytes; matters only for editable TN, where Book writes back the dominant EOL/BOM. (Was 10.)
- **The role a TN pick takes:** `tn` (`ROLES.translationNotes`), from the kind table. (Was 11.)
- **Download speed.** Will ruled the newest-only shallow clone fine (2026-10-12): 13.2 s before round 2, 13.9 s after, on one machine (noise about ±0.5 s). The archive endpoint cannot be reached from a browser (the WACS proxy refuses `/archive/`; the content host challenges direct requests); a clone without a working tree was slower overall. If speed matters later, the lever is reading the git pack directly through its `.idx`, not an archive. Measurements in `storage.md`. (Was 15.)
- **Progress on a slow line.** Built: the toast moves the whole way (megabytes received, reading, "Packing ROM: book 45 of 66"); 176 s on slow 3G. (Round 2.)
- **The tutorial's project.** The Bisa Bible (`Will_Kelly/leb-x-bisa_reg`, `host=` named); `x-en-ulb` declares an `en_asv` source WACS refuses with 401. One constant in `tours/notes.ts`. (Was 17.)

## Interface changes the next kinds will need

Recorded rather than built: building them now would shape the interface around kinds nobody has asked for. Each is additive. The kinds guide repeats them per kind.

- **Opening with progress.** Macula's `openCorpus` reports download progress (Hebrew is about 44 MB); `KindRow.open` has no progress channel. It gains an optional `onProgress`, as `pack` already has. TW does not need it.
- **What `open` is given.** Rows get `(fileSystem, resource)`. Macula's row needs fetch and a wasm URL; it closes over its platform module (`src/platform/web/macula.ts`), which the table may import from `src/app`. If that is awkward, `open` takes `Services`.
- **A kind's own search.** Macula's faceted find is not a haystack: an optional handle slot (e.g. `query`) and a search panel in the renderer registry, shown by Find beside the text find (plan §9). `documents` stays the default.
- **Below the verse.** Macula's entries are a verse's words, which `Places.at(verse)` carries; aligned-word highlighting needs an answer finer than Address (plan §11.2). Not forced by anything built.
- **Dictionary hits.** A TW document has many Addresses, so Find's join makes a card per occurrence verse; a kind-supplied hit card in the panel would read better. TW would also add an `rcDictMarkdown` format and an `Article` entry type.
- **A `builtin` container.** Macula has no manifest: `ContainerKind` gains `builtin`, registered by its adapter with `content` set directly, never through `recognize`.
