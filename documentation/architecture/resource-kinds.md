# Adding a resource kind

How to teach Sefer to hold something new — Translation Words, Macula, Translation Questions, a TSV edition of notes, a packed release — without the rest of the app learning about it. Translation Notes (TN, WA's `en_tn`) is the one kind built beside scripture, and it is the worked example throughout. What exists is described in [resources](resources.md), "Resource kinds"; the reasoning is in `planning/items/2026-10-06-resource-kinds.mdx` (§3–§5, §14, §15); open questions are in `planning/items/2026-10-06-resource-kinds.mdx`, §16.

## The shape in one paragraph

A Library row carries two facts: how it is packed (`ContainerKind`: `burrito | resourceContainer | looseUsfm`) and what it holds (`ContentKind`: `usfm | tn | tq | tw | macula-greek | macula-hebrew`, closed), plus the one reader that parses it (`Recognition["format"]`). The content kind is consulted in exactly two places: `recognize()` when a root is registered, and the renderer registry when a screen draws it. Between them, everything asks a `ResourceHandle` whether it has a slot (`places`, `documents`, `edit`), never which kind it is. A kind is: a recognition case, a reader, a kind-table row, an adapter that fills some slots, and a renderer case.

```text
library.add(root)
  └─ classify (container) ─ recognize (content + format)         src/core/resources/kinds/content.ts
kind table row: role · engineBooks · pack? · open                src/app/kinds/table.ts
  └─ open → ResourceHandle<Entry> { info, places?, documents?, edit?, release }   src/core/resources/kinds/handle.ts
shell.resources (opened once, released with the project)         src/app/kinds/handles.ts
renderer registry: switch (content) → pane                       src/app/ui/kinds/registry.tsx
```

## The rules a kind keeps

1. **Never recognise by filename.** A kind is decided from decoded metadata only (a Resource Container's `dublin_core` `type`, `identifier`, `format`; a Burrito's flavour). `recognize()` opens no content file. A mismatch is a refusal with a sentence, never a guess and never a try-the-next-reader cascade. The one exception is the container with no manifest, loose USFM, decided earlier by `classify`.
2. **Never reshape upstream's layout.** What is on disk stays as upstream wrote it, so git, export and a pull keep working. Anything Sefer derives (an index, a pack) lives under `<root>/.sefer/`, which a clone excludes from git.
3. **Derived stores are stamped and rebuilt.** A pack says what it was built from (a listing fingerprint, or the commit imported) and is rebuilt when that moves. Never edit a pack by hand or treat it as the source of truth while the raw files are there.
4. **Read-only on the Web unless decided otherwise.** On the Web a many-file resource is kept as packs only (OPFS pays per file: 29,300 files took 22.6 s against 0.14 s for 73 packs, [storage](storage.md)). Editing a non-USFM kind is a desktop concern, typed (`edit`) and not built.
5. **Typed discriminants, not `kind === …` checks.** Code outside `content.ts`, `app/kinds/table.ts` and `ui/kinds/registry.tsx` never reads `Resource.content`. A workflow asks the table (`holdsEngineBooks(resource)`, `roleFor(resource)`); a screen asks the handle (`handle.documents !== undefined`).
6. **Address is the only place vocabulary.** A kind speaks to the rest of the app in `Address` (`packages/text/src/location/address.ts`): what it holds at a place, and the places an entry belongs to. No marker, no Book, no offsets into somebody else's text cross the handle.
7. **Fail with `Unavailable`.** Every handle call is an Effect failing `Unavailable { reason: "Missing" | "Unreadable" | "Unsupported", description }`. "This resource has nothing for Philemon" is `Missing`, an ordinary answer a pane says in one line.
8. **A copy from a git remote records its upstream, so it can be checked.** `Library.add(root, { url, commit })` with the commit it holds (`arrival.referenceCopy` does); the pattern and where checking belongs: [sync](sync.md), "Upstreams: one pattern for everything from a git remote".
9. **Readers are pure.** A reader takes bytes (as text) and returns records, importing nothing of Sefer's but `Address`'s vocabulary and a parser. Whatever is convention rather than spec lives in that one reader, in a function named for it (TN's `closeAtNextSibling`).

## A new content kind

In order. TN's file is named at each step; a new kind copies its shape.

**1. Name it.** Add the member to `ContentKind` in `src/core/resources/kinds/content.ts` if it is not there (TQ, TW and Macula already are). TypeScript then refuses to build until the kind table and the registry say what they do with it.

**2. Recognise it.** Add a member to `Recognition` (kind + format) and a case in `recognize()`, from metadata only. TN: an RC with `type: help`, `identifier: tn`, `format: text/markdown` answers `{ content: "tn", format: "rcHelpMarkdown" }`. Today `tq`, `tw` and other formats of `tn` fall to "no reader yet", which is where a new case goes. Add the format literal to the Library's `ResourceRecord` schema (`format: Schema.Literals([...])` in `src/core/resources/library.ts`) so `library.json` can store it; the `content` literal list there already holds every kind.

**3. Write the reader** in `src/core/resources/kinds/<kind>/`. Pure: files in, records out, validating as it goes. TN: `tn/rcHelpMarkdown.ts`, `readHelpBook(files)` → `{ kind: "read", notes, skipped } | { kind: "refused", description }`, splitting at top-level headings found by markdown-it and cutting the exact text there. Files it does not read go in `skipped`, with why.

**4. Define the entry and its Address.** The record everything above the reader sees. TN: `tn/note.ts`, `Note { address, openEnded?, ordinal, body, quote?, heading? }`; `noteOf` turns a reader record into a `Note`, closing an open range with `PlaceContext.versesIn` when lent one; `answersPlace` decides which entries answer a place. Add the entry type to `EntryOf` in `kinds/handle.ts` so `OpenHandle` carries it.

**5. Store it, if it is many files.** A per-book (or per-unit) pack with a stamp: TN's `tn/pack.ts`, `<root>/.sefer/packs/tn/<BOOK>.json`. `bookPack` reads a pack, rebuilding it first when the raw tree is there and its listing fingerprint moved; `packHelp(from: UpstreamTree, to, provenance, onProgress)` packs a whole tree into a root that holds only packs (the Web), checks each reads back, and removes what it wrote on failure. Read upstream files through `UpstreamTree` (`kinds/tree.ts`) so a folder, a clone staged in memory or later a zip all feed the same code.

**6. Write the adapter**, a function returning `Effect<ResourceHandle<Entry>, Unavailable>`. In `src/core/resources/kinds/<kind>/adapter.ts` when it needs only the `FileSystem` port (TN: `openTranslationNotes`, holding three books' packs and loading others on demand); in `src/platform/*/` when it fetches or loads wasm, which `pnpm boundaries` keeps out of core. Fill only the slots the kind has:

| Slot                             | Fill it when                                              | TN                                                      |
| -------------------------------- | --------------------------------------------------------- | ------------------------------------------------------- |
| `info`                           | always                                                    | content, title, language, direction                     |
| `places.at(address, context)`    | the kind answers "what is at this verse"                  | the notes whose chunk covers the verse                  |
| `places.of(entry)`               | always, with `places`                                     | `[note.address]`                                        |
| `documents.list(books, context)` | its text should be searchable by Find's default text find | one `HaystackDocument { id, text, addresses }` per note |
| `edit`                           | never yet: read-only is its absence                       | absent                                                  |
| `release`                        | always                                                    | drops held packs                                        |

**7. Add the kind-table row** in `src/app/kinds/table.ts`: `role` (the role a pick takes, `ROLES.translationNotes` for TN), `engineBooks` (true only for USFM books the engine registers), `pack` (how it is kept where its tree is too many files: TN's `packHelp`; omit to keep the tree as cloned), and `open` (the adapter).

**8. Add the renderer case** in `src/app/ui/kinds/registry.tsx`: `byKind` gains a case drawing the kind's pane, which receives the handle typed for its kind. The pane consumes the handle through `createHeld` (`src/app/ui/primitives/held.ts`: the last answer held, a `DelayedSpinner` only after `PENDING_MS`) and follows `shell.place()`. TN: `NotesPane.tsx`. `ResourceCard` decides what a folded card shows. The reference column needs no change: it draws whatever the registry hands back, and lists the kind under Reference material because `roleFor` is not `source`.

**9. Find, if any.** Nothing to do for the default: a handle with `documents` is searched by `Search.findInDocuments` under Find's "Search {title}" switch (scope `helps`), each hit joined by its Addresses to the project's verse card. A kind with a better question than text (Macula's facets) needs its own slot and panel, not built (below).

**10. Make it downloadable, if it is.** If the catalogue lists it, it arrives like any source text. If it is a help (TN today, and only TN by ruling), the catalogue lists it by `resource_type`: add a query beside `listTranslationNotes` in `src/app/catalogue.ts` and a section under the reference column's **Reference material**; `downloadHelp` (`src/app/kinds/download.ts`) brings it through `arrival.referenceCopy` with a progress toast: newest-only clone, recognised, packed on the Web, registered with `Resource.upstream { url, commit }` ([resources](resources.md), "Provenance and updates").

**11. Document it.** A section in [resources](resources.md) for the kind, its row in [services](../services.md), and any measurement in [storage](storage.md).

## A new format inside an existing kind

Example: unfoldingWord's TSV notes (`tn` in `text/tsv`, one file per book, columns `Reference ID Tags SupportReference Quote Occurrence Note`) beside WA's Markdown.

- Add a format literal and a `Recognition` member, `{ content: "tn", format: "uwHelpTsv" }`, and its case in `recognize()` (RC `type: help`, `identifier: tn`, `format: text/tsv`). Add the literal to `ResourceRecord.format` in `library.ts`.
- Write the reader, `kinds/tn/uwHelpTsv.ts`, pure, returning the SAME records the Markdown reader does, so everything above it is unchanged: the `Reference` column (`1:28`, `1:28-29`, `1:intro`, `front:intro`) maps straight onto TN's `Span` (no table of contents needed), `Quote` is the quote, `Note` the body, and `ID` an identity the Markdown layout lacks. Its convention (the column layout, the header check) lives in this reader only.
- Point the adapter's pack step at the right reader by `resource.format`. The adapter is the one place below the registry that may look at the format, because choosing the reader is its job.

Nothing in the pane, Find or the reference column changes: they see `Note`s.

## A new container

Containers say where the bytes are; recognition says what they are.

- **Burrito.** Already a container. A non-scripture Burrito (notes as an `x-` flavour) needs a case in `recognize()`'s `burrito` branch keyed on the flavour, and its reader reads the files the `ingredients` name, using their `scope` instead of a layout grammar (Burrito exists partly to remove the chunk-number convention).
- **Resource Container.** Already a container: `classify` decodes `manifest.yaml`, `describe` reads it, `recognize` reads `dublin_core`. A new RC `type` (`dict` for TW, `man` for Translation Academy) is a new case in `resourceContainer()` there.
- **A zip or other archive.** Not a new kind of resource, a new way to reach the files: stage its entries in the in-memory FileSystem (as Writer's `pickLocal` does) and hand `treeInFolder(memoryFs, root)` to the kind's `pack` step, so the tree is never written to OPFS. Recognition then runs on the staged manifest as for any root.
- **A packed release** (per-book packs published beside the repository, the content-team ask): a root that holds only packs is already a supported shape (the Web's), so a release is a download of those files plus the manifest, recognised as usual; the pack stamp's `import` variant records where it came from.
- **A `builtin` container** (Macula: one opaque blob, no manifest, URL and checksum compiled into the adapter): `ContainerKind` gains `builtin`; its row is registered by its adapter with `content` set directly and never passes through `recognize()`. `root` stays a string (the path of the one cached object).

## Not built: Translation Words and Macula

**Neither is built, and neither may be started without a PO decision.** These sketches say where each would go, so the decision can be made knowing the cost. The slot-by-slot walk is plan §15.

**Translation Words** (`type: dict`, `WycliffeAssociates/en_tw`, fetch `bible/` only):

- `recognize`: `{ content: "tw", format: "rcDictMarkdown" }` for RC `dict` + `tw` + `text/markdown`.
- Reader `kinds/tw/rcDictMarkdown.ts`: one article per `bible/<category>/<slug>.md`, title from its first heading, and `bible/config.yaml` mapping each term to its occurrences (Addresses), so `places` needs no scan.
- Entry `Article { slug, category, title, body, strongs? }`; `places.at` the articles occurring in a verse, `places.of` all their Addresses; `documents` one per article.
- Pack: per category or one for the dictionary (1,011 articles), through the row's `pack`.
- Row: role `tw` (already in `ROLES`), `engineBooks: false`. Registry: a pane listing the terms at the caret's verse.
- Interface addition it would want: a kind-supplied hit card for Find (an article has many Addresses, so the default join makes a card per occurrence verse).
- Also on the table: TW behind `/terms`' catalogue port instead of, or before, a pane (plan §12).

**Macula** (Greek and Hebrew syntax trees, `@wycliffeassociates/macula`):

- Container `builtin`, no `recognize`. Adapter in `src/platform/web/macula.ts`: `openCorpus` with the blob cached by checksum; `info()` validated through an Effect Schema at open.
- `places.at(address)`: `read(book, chapter)` filtered to the verses, each `Passage` converted to an `Address` in the adapter. Entry: a verse with its words. No `documents`; no `edit` (an alignment fix is a write to the project's USFM).
- Registry: its own right-to-left DOM, a word's parsing on hover, emitting only Addresses.
- Interface additions it would need, all additive: an optional progress channel on `KindRow.open` (the Hebrew blob is about 44 MB); `open` given a fetch and a wasm URL (closing over its platform module, or taking `Services`); an optional handle slot for its faceted find plus a search panel Find shows beside the text find; an answer below the verse for aligned-word highlighting (plan §11.2), not forced by anything else.

The same list, kept current, is in the questions file under "Interface changes the next kinds will need".
