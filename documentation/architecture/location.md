# Location: Citation, Address and places in a text

Every question of the form "where in scripture" goes through one set of pieces. What somebody typed is a **Citation**; the place it means is an **Address**; where that place is in one particular text is a **Location**. Nothing in Sefer keeps its own copy of any of those answers, and nothing reads a USFM designator (`\c 12`, `\v 3a`) itself: the engine does, and Sefer reads its TOC.

`src/core/location` holds the pure pieces; `src/app/location.ts` is the per-project door the shell exposes as `shell.location`. The decisions below were made with Will on 2026-09-24 and 2026-09-25; the planning discussion they came from is in git history (`planning/01-discussing/editor-primitives-consistency.md`).

## Four words, one job each

| Term         | Is                                                                                                                                                   | Is not                                                     | Example                               |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------- |
| **Citation** | The characters somebody wrote, in an input box or prose, plus the `Address[]` they mean.                                                             | A place. It is text about a place.                         | "Mat 1:1,3" → two Addresses           |
| **Address**  | A place independent of any translation. No text, no offsets, no hash.                                                                                | A claim that any text contains it.                         | `MAT 1:1-3`                           |
| **Location** | A place in ONE text: UTF-16 source offsets (half-open) and the stamp of the exact text they index. May carry the Address it was resolved from or to. | Portable. Its offsets mean nothing apart from its text.    | the project's LUK, 1204–1388, stamp … |
| **Anchor**   | A persisted, versioned claim about a Location (original Location, quote, context, attachment status). For comments; **not built**.                   | A thread's identity. A thread survives its Anchor failing. | a passage thread's anchor             |

"Reference" is not one of them. Sefer spends that word on the _reference resource_ (`ReferencePane`, `recipes/reference.ts`), so it stays product copy for reference texts and nothing else. The [glossary](../glossary.md) carries the same rule.

## Three directions, one answer each

| Question                                                            | Who answers                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| What does `\v 3a` or `\c 12` mean?                                  | **Onion**, surfaced through the Galley TOC (`tocViewOf`, `src/core/galley/location.ts`). Sefer never reads a designator. |
| What did this person write?                                         | **The Citation parser** (`citation.ts`): text + name catalogue → `Address[]` or invalid. Pure.                           |
| Where is this Address in this text? What Address is at this offset? | **Location** (`locate.ts`): `resolve` and `addressAt`, pure functions over one text's TOC.                               |
| Which names, which text, how to display                             | **The application's location service** (`src/app/location.ts`). Wiring and policy; no parsing or searching of its own.   |

## Address

```ts
type Point = { readonly chapter: number; readonly verse: number; readonly segment?: string };

type Address =
  | { readonly kind: "book"; readonly book: BookId }
  | { readonly kind: "intro"; readonly book: BookId }
  | { readonly kind: "chapters"; readonly book: BookId; readonly from: number; readonly to: number }
  | { readonly kind: "verses"; readonly book: BookId; readonly from: Point; readonly to: Point };
```

- **Every verse Address is a range.** A single verse has equal ends; a cross-chapter range (`MAT 1:20-2:3`) is two points, never a list, because expanding it would need to know how many verses chapter 1 has — versification, which differs by text.
- **Front matter is `intro`, never chapter 0.** Whatever word was typed ("intro", "introduction", a localized word), the result is `{ kind: "intro" }`. A peripheral book with no chapters is addressed by `book`.
- **A segment is a coordinate.** `3a` and `3b` are different places; `MAT 1:3` covers both. Points compare by chapter, verse, then segment.
- **Spelling is U23003's basic reference** (`MAT 1:1-3`, `MAT 2-4`, `JUD 1:4`): `addressCode`. What a person reads is `addressLabel`, with the project's own book name first and English second ("Lucas 1:1-2").
- Constructors: `bookAddress`, `introAddress`, `chaptersAddress(book, from, to = from)`, `versesAddress`. Use them rather than object literals.

## Citation

`parseCitation(text, catalogue, { grammar, held })` returns `{ ok: true, addresses }` or `{ ok: false, problem }`.

- **Grammar.** `;` starts a new chapter group, `,` adds a verse or range in the current chapter, `-`/`–` makes a range, `:` separates chapter from verse, and book and chapter carry forward. `Mat 1:1,3; 2:4-6; Mrk 3:1` is four Addresses, kept as written: a consumer can coalesce, it cannot un-merge.
- **Two grammars.** `navigation` (the palette, the sidebar) is forgiving: a book prefix is enough, and `,` or `.` separate chapter from verse because it only ever reads one Address. `prose` needs a full name or a registered abbreviation. There is no prose scanner yet; its first consumer is comments.
- **Names are an input, never global.** The name catalogue (`names.ts`) says which words mean which book: the canon's English name, the id, every name the project's metadata gives in any locale, registered abbreviations, and the words for `intro`. `matchBook` is the one best book for a word; `booksMatching` is every book a partly typed word could mean (the sidebar's filter); `citationWords` is the book part of what was typed.
- **Two kinds of failure, and parsing only reports the first.** _Invalid_ is not a Citation at all: an unknown book word, verse 0, a range ending before it starts. _Missing_ is a real Address the text lacks, and is always a resolution outcome. The held books (which books this project has) only break ties between prefixes: "phil" in a project with Philemon and no Philippians goes to Philemon.
- **The one tested file in Sefer.** `citation.test.ts` is table-driven, and the parser is the single exception to the build-out rule of no new tests, because most of the application stands on it (Will, 2026-09-24).

## Location: resolving and labelling over a TOC

`resolve(toc, address)` answers one of:

- `found` — `from`, `to`, what the span actually `covers` (an Address), and `coarser` when the text could only answer less precisely than asked;
- `missing` — which part (`intro`, `chapter`, `verse`) and, for a verse, the chapter it would be in (`within`);
- `ambiguous` — malformed text, such as two `\c 3` or two anchors for one verse. First-class, because anything that attaches, edits or persists must not silently pick one.

`addressAt(book, toc, offset)` is the inverse: the Address of the unit an offset is in (introduction, chapter head, or verse).

The rules, with the engine's facts (Kitchen v0.1.7) underneath them:

- **A bridge is labelled as the bridge.** `LUK 1:2` against `\v 1-2` finds the bridge's span and `covers` `LUK 1:1-2`; a caret in it reports `LUK 1:1-2`. Found by TOC lookup, never by arithmetic on verse numbers.
- **A segment is exact when the text has it.** `MAT 1:3a` finds `\v 3a`'s span exactly. Over plain `\v 3` it finds the whole verse, `coarser: true` — shown as found, never as exact. `MAT 1:3` over `\v 3a` … `\v 3b` finds both.
- **A verse list has holes.** `\v 1,3,5` covers 1, 3 and 5: `MAT 1:3` is found in it, `MAT 1:2` is missing. A caret inside it is labelled by its hull, `1-5`: an Address is one range, and the hull leaves out nothing the caret is in; `resolve` is what refuses the holes.
- **A chapter is its designator, not its position.** A TOC's verse rows carry the POSITION of their chapter row; a chapter row carries its `number`. An Address means the designator, so the resolver goes through chapter rows by number, never by index.
- **Offsets are UTF-16 source offsets.** Projected editor offsets are converted at the editor boundary before Location sees them.

The TOC comes from the engine. `tocViewOf(analysis)` (`src/core/galley/location.ts`) adapts an analysis's dish into a `TocView` (chapters, verses with their label end, and members only where the hull does not say what a verse covers), cached per dish. A label is only as current as the analysis it came from: `shell.location.addressAt` refuses when the analysis no longer describes the text the offset was measured in.

## The application's location service

`createLocation(project)` in `src/app/location.ts`, exposed as `shell.location`. Not an Effect service: it is synchronous and scoped to one project.

- `read(text)` — a navigation Citation against this project's name catalogue and held books.
- `books(text)` — every book the words could mean, in canon order.
- `label(address)` — what a person reads.
- `addressAt(book, offset, measured, analysis)` — the Address at an offset, or `undefined` when the analysis has moved on.

The name catalogue and the held books are memos over the project and its metadata, built once per change of either and read at call time, never captured at setup.

## Who uses it

- The **palette** and the **sidebar filter** read Citations; the sidebar's chapter tiles for a book that is not open come from that book's held analysis TOC.
- **`showReference`** resolves after focusing the book, and says so when a verse is missing (falling back to the chapter) or ambiguous.
- **Findings** and the **character inventory** label a site with `addressAt`, only when the stamp matches.
- **Key terms**: the source card reads a bound resource's book through Library, analyses it, and resolves the verse, skipping the `\v N` label by the TOC's label end.
- The **sync plan** splits each revision of a book by the engine's chapter rows.
- **Search** and **Excerpts** — see [search](search.md) and [key terms](stet.md) for how their labels and anchors are resolved.

## Not built yet

- **Anchor** and mapping an Anchor through edits: for comments. The mechanism is outlined in `planning/00-ideas/commenting-and-discussion.md`.
- **Text identity across sessions.** In a session a Location carries the Source stamp (Revision + length). When one is persisted it will carry a Fingerprint — `{ alg: "xxh3-64", hash, length }` over the Source (LF-normalized UTF-8, no BOM), from Galley's `xxh3Text` — never over disk bytes, so a change of line endings does not detach a comment. A mismatch means re-resolve, not lost.
- **A prose scanner** and "copy link to highlight" (`[Mat 1:14](sefer:MAT/1:14?at=…&fp=…)`), with comments.
- **Verse `end`** (U23003's `MAT 2:5-end`): one union member, added when a consumer types one.
- **Non-verse targets** (a footnote, a heading): a Location is already a span, so they need no coordinates of their own. A `part` qualifier on the derived answer, or the engine's `(sid, where, ordinal)` block address, when a consumer needs one to survive edits; U25002's `@aid` for USFM 3.2 texts.
- **`covering`** (the Addresses a selection spans), when a consumer needs it.

## U23003

The Address model is U23003's basic reference ([readable copy](https://github.com/paranext/marble-tools/blob/main/docs/u23003.md)): book, chapter, verse, ranges and lists, contextual carry-forward, and bridges intersected with the text's verse units. Sefer does not adopt its word and character indexes (`!` refinements): they are a second coordinate system that must be recomputed against the text and, by the proposal's own account, do not survive edits. UTF-16 offsets plus a Fingerprint are exact and draw directly. Consuming the scripture-analysis-api's U23003 items is an adapter at the edge, when it is needed.
