# Location: Citation, Address and places in a text

Every question of the form "where in scripture" goes through one set of pieces. What somebody typed is a **Citation**; the place it means is an **Address**; where that place is in one particular text is a **Location**. Nothing in Sefer keeps its own copy of any of those answers, and nothing reads a USFM designator (`\c 12`, `\v 3a`) itself: the engine does, and Sefer reads its TOC. The one allowed regex over markup is `src/app/legacyMarkers.ts`'s "does this project's text contain `\s5` alone on a line", because its answer configures the engine before the engine may parse ([galley](galley.md#the-marker-table-setcustommarkers)).

`packages/text/src/location` holds the types and the TOC walk; `src/app/location.ts` is the per-project door the shell exposes as `shell.location`. The decisions below were made with Will on 2026-09-24 and 2026-09-25; the planning discussion they came from is in git history (`planning/01-discussing/editor-primitives-consistency.md`, retired 2026-09-25 when the work landed).

## Four words, one job each

| Term         | Is                                                                                                                                                   | Is not                                                     | Example                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------- |
| **Citation** | The characters somebody wrote, in an input box or prose, plus the `Address[]` they mean.                                                             | A place. It is text about a place.                         | "Mat 1:1,3" → two Addresses           |
| **Address**  | A place independent of any translation. No text, no offsets, no hash.                                                                                | A claim that any text contains it.                         | `MAT 1:1-3`                           |
| **Location** | A place in ONE text: UTF-16 source offsets (half-open) and the stamp of the exact text they index. May carry the Address it was resolved from or to. | Portable. Its offsets mean nothing apart from its text.    | the project's LUK, 1204–1388, stamp … |
| **Anchor**   | A persisted, versioned claim about a Location (original Location, quote, context, attachment status). For comments; **not built**.                   | A thread's identity. A thread survives its Anchor failing. | a passage thread's anchor             |

"Reference" is not one of them. Sefer spends that word on the _reference resource_ (`ReferencePane`, `recipes/reference.ts`), so it stays product copy for reference texts and nothing else. The [glossary](../glossary.md) carries the same rule.

## Three directions, one answer each

Since kitchen 0.1.21 every answer is galley's (the `reference` crate and `onion`'s resolver); Sefer keeps the wiring, the names it supplies and the policy.

| Question                                                            | Who answers                                                                                                                                                    |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What does `\v 3a` or `\c 12` mean?                                  | **Onion**, surfaced through the Galley TOC (`tocViewOf`, `packages/text/src/engine/location.ts`). Sefer never reads a designator.                              |
| What did this person write?                                         | **galley's `Citations`**: text + the project's names → `Address[]` or invalid.                                                                                 |
| Where is this Address in this text? What Address is at this offset? | **galley's `resolve` and `addressAt`**, bound onto every `Analysis` by the host that parsed it (`analysis.resolve`, `analysis.addressAt`; `engine/places.ts`). |
| How is an Address spelled?                                          | **galley's `formatReference`** (machine: `LUK 1:1-2`, `LUK 0`) and **`showReference`** (a person's: `Lucas 1:1-2`, with the caller's name and intro word).     |
| Which names, which text, how to display                             | **The application's location service** (`src/app/location.ts`). Wiring and policy; no parsing or searching of its own.                                         |

## Address

```ts
type Point = { readonly chapter: number; readonly verse: number; readonly segment?: string };

type Address =
  | { readonly kind: "book"; readonly book: BookId }
  | { readonly kind: "intro"; readonly book: BookId }
  | { readonly kind: "chapters"; readonly book: BookId; readonly from: number; readonly to: number }
  | { readonly kind: "verses"; readonly book: BookId; readonly from: Point; readonly to: Point };
```

`packages/text/src/location/address.ts` holds the types (with `Resolution`) and the constructors, nothing else. galley's `BookAddress` is the same shape.

- **Every verse Address is a range.** A single verse has equal ends; a cross-chapter range (`MAT 1:20-2:3`) is two points, never a list, because expanding it would need to know how many verses chapter 1 has: versification, which differs by text.
- **Front matter is `intro`.** Whatever word was typed ("intro", "introduction", a localized word), the result is `{ kind: "intro" }`; its machine spelling is `MRK 0`. A peripheral book with no chapters is addressed by `book`.
- **Verse 0 is a chapter's title.** `PSA 3:0` is Psalm 3's `\d`; `addressAt` answers it for an offset inside the title.
- **A segment is a coordinate, one lowercase letter.** `3a` and `3b` are different places; `MAT 1:3` covers both.
- Constructors: `bookAddress`, `introAddress`, `chaptersAddress(book, from, to = from)`, `versesAddress`. Use them rather than object literals.

## Citation

`shell.location.read(text)` is `Citations.read(text, { grammar: "navigation", held })`: `{ ok: true, text, addresses, assumed }` or `{ ok: false, text, problem, word? }`. The cases are the kitchen's (`reference/fixtures/cite.json`).

- **Grammar.** `;` starts a new chapter group, `,` adds a verse or range in the current chapter, `-`/`–` makes a range, `:` separates chapter from verse, and book and chapter carry forward. `navigation` takes a book prefix and reads `3,1` as `3:1`; `assumed` says when it did either.
- **Names are an input, never global.** One `Citations` per project and interface language holds every name the project's metadata gives a book, in any locale, plus canon's names for the interface language (`src/app/canonNames.ts`; English is always in), the project's books outside canon's table, and the word for the introduction.
- **Two kinds of failure, and parsing only reports the first.** _Invalid_ is not a Citation at all: an unknown book word, a range ending before it starts. _Missing_ is a real Address the text lacks, and is always a resolution outcome. The held books only break ties between prefixes: "phil" in a project with Philemon and no Philippians goes to Philemon.
- **A single-chapter book's number is a verse.** `Jude 3` is `JUD 1:3`.

## Location: resolving and labelling

`analysis.resolve(address)` answers one of:

- `found`: `from` (the `\v`), `to` (where the next place's tile begins), `opening` (where this place's own tile begins, its heading and paragraph marker), what the span actually `covers`, and `coarser` when the text could only answer less precisely than asked;
- `missing`: which part (`intro`, `chapter`, `verse`) and, for a verse, the chapter it would be in (`within`);
- `ambiguous`: malformed text, such as two `\c 3` or two anchors for one verse. First-class, because anything that attaches, edits or persists must not silently pick one.

`analysis.addressAt(book, offset)` is the inverse: the introduction, a chapter's head, its title (verse 0), or the verse whose tile holds the offset. An offset outside `[0, length]` is `undefined`, never clamped.

The rules are galley's (`onion/src/resolve.md` in the kitchen): a bridge is labelled as the bridge; a segment is exact when the text has it and `coarser` when it does not; a verse list has holes; a chapter is its designator, not its position; offsets are UTF-16 source offsets.

**Tiles.** A verse owns the heading and paragraph marker that introduce it. `\s1 Heading` / `\p` / `\v 14` are verse 14's, so a heading is never in the verse before it. Chapters stay hard breaks.

**Binding.** galley answers a registered book from what it already holds (about 0.03 ms on Psalms) and any other text by lexing it again (1 to 3 ms). `src/core/galley/galley.ts` binds a book analysis to its id's doors while the id still holds that analysis's text, and to the text doors after; every other text (a reference, a review side) gets the text doors. `addressAt` answers are kept per offset on the analysis.

**Stepping** is the one walk Sefer keeps: `packages/text/src/location/units.ts` lists a TOC's units (introduction, chapter head, each verse's tile, cut at the census's `start`) for an excerpt's "one more above", a diff's grouping and a suppression's verse. A unit is named by `analysis.addressAt(book, unit.from)`, never by Sefer.

## The application's location service

`createLocation(project)` in `src/app/location.ts`, exposed as `shell.location`. Not an Effect service: it is synchronous and scoped to one project.

- `read(text)`: a navigation Citation against this project's names and held books.
- `books(text)`: every book the words could mean, in canon order (`Citations.booksMatching`).
- `label(address)`: what a person reads (`showReference` with the project's book name).
- `addressAt(book, offset, measured, analysis)`: the Address at an offset, or `undefined` when the analysis has moved on.

The `Citations` and the held books are memos over the project, its metadata and the interface language, built once per change and read at call time, never captured at setup.

## Who uses it

- The **palette** and the **sidebar filter** read Citations; the sidebar's chapter tiles for a book that is not open come from that book's held analysis TOC.
- **`showReference`** resolves after focusing the book, and says so when a verse is missing (falling back to the chapter) or ambiguous.
- **Findings** and the **character inventory** label a site with `addressAt`, only when the stamp matches. A suppression names its verse by the unit's start, so a site in a heading belongs to the verse the heading introduces.
- **Key terms**: the source card reads a bound resource's book through Library, analyses it, and resolves the verse, skipping the `\v N` label by the TOC's label end.
- The **sync plan** splits each revision of a book by the engine's chapter rows.
- **Search**: a hit's Address is `addressAt` over an analysis the CALLER supplies (`analysisOf`), and only when it describes exactly the scanned text; with none, the hit has no Address and there is no fallback scanner. Search stays synchronous and pure. See [search](search.md).
- **Excerpts and Key terms**: `refOccurrences` resolves each guide Address in the project book (a bridge's two verses land on one card; a list's holes are missing), each card carries the Address of its unit, and a book's own name comes from its `\h` (`bookHeading`, off the engine's tokens) after the project's metadata name. See [key terms](stet.md).

## Not built yet

- **Anchor** and mapping an Anchor through edits: for comments. The mechanism is outlined in `planning/items/2026-09-21-commenting-and-discussion.mdx`.
- **Text identity across sessions.** In a session a Location carries the Source stamp (Revision + length). When one is persisted it will carry a Fingerprint — `{ alg: "xxh3-64", hash, length }` over the Source (LF-normalized UTF-8, no BOM), from Galley's `xxh3Text` — never over disk bytes, so a change of line endings does not detach a comment. A mismatch means re-resolve, not lost.
- **A prose scanner** and "copy link to highlight" (`[Mat 1:14](sefer:MAT/1:14?at=…&fp=…)`), with comments.
- **Verse `end`** (U23003's `MAT 2:5-end`): one union member, added when a consumer types one.
- **Non-verse targets** (a footnote, a heading): a Location is already a span, so they need no coordinates of their own. A `part` qualifier on the derived answer, or the engine's `(sid, where, ordinal)` block address, when a consumer needs one to survive edits; U25002's `@aid` for USFM 3.2 texts.
- **`covering`** (the Addresses a selection spans), when a consumer needs it.
- **`Occurrence` → `Hit`.** A search result is not a Location word; when it is renamed it becomes Hit, the word the replace gate already uses. Naming only.
- **The next composition test** is a reference preview or a comment anchor: only after one of those is built is it worth judging whether an N-column aligned view needs a reusable container. Until then Find's excerpt list and the reference pane stay two recipes over the same Location answers.

## U23003

The Address model is U23003's basic reference ([readable copy](https://github.com/paranext/marble-tools/blob/main/docs/u23003.md)): book, chapter, verse, ranges and lists, contextual carry-forward, and bridges intersected with the text's verse units. Sefer does not adopt its word and character indexes (`!` refinements): they are a second coordinate system that must be recomputed against the text and, by the proposal's own account, do not survive edits. UTF-16 offsets plus a Fingerprint are exact and draw directly. Consuming the scripture-analysis-api's U23003 items is an adapter at the edge, when it is needed.
