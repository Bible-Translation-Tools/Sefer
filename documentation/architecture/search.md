# Search

`src/core/search/search.ts` is project-wide Find and the Replace behind it. It takes `readonly Book[]` rather than a Project so the result browser, a satellite window and a script can each call it with whatever books they hold. Every door is pure and synchronous, returns a `Result`, and calls no engine search.

## Two haystacks, two matchers

- `findInReading(readings, books, query, options?)` — **the default.** Scans each book's READING — what the reader sees in visual mode, the markup cut out — and places every hit back in the source.
- `find(books, query, options?)` — the raw scan of canonical USFM, for a search deliberately aimed at the markup.
- `findInReferences(readings, references, query, options?)` — the same scan as `findInReading`, over the project's bound source and reference resources.

What is matched against (reading or raw) and what is matched with (literal or regex) are two switches, so all four combinations work. Matching is a JS `RegExp` — a literal is escaped into one — with the `i` flag unless `caseSensitive`, and `wholeWord` is checked on the characters either side of the match (`\p{L}\p{N}_`), so it works for literals and regexes alike and for non-ASCII scripts, where `\b` would not.

The engine's own `find`/`findAll` ([Galley](galley.md)) are not used: they rebuild and re-fold every projection on every call and cannot run a regex or search the markup.

## The reading

`src/core/search/reading.ts` builds a `Readings` over the engine's mask map — the source spans the reading is made of, in order. The map is kept, keyed by the book's `SourceStamp`; the reading itself is rebuilt per call (about 9 ms for a Bible) rather than held as a second copy of the corpus. Nothing is case-folded ahead of time, because `toLowerCase` changes the length of some strings and every later hit would map back to the wrong place. `reading.ts` records the measurements.

A book the engine holds no mask for contributes nothing: a project opening registers books one at a time, and a search that arrives mid-way reports what is ready rather than failing.

## Queries, options, failures

- `Query { text, caseSensitive?, wholeWord?, regex? }`.
- `Options { limit?, books?, analysisOf? }`. `limit` is a total across all books and omitted means no bound; `books` narrows the scan to those `BookId`s; `analysisOf` is where a hit's Address comes from (below). The bound is on the question instead: `MINIMUM_QUERY = 2`, measured on a whole Bible, below which the screen does not search — a single character is a quarter of a million hits nobody can read, and a capped count would answer "how many are there" wrongly.
- `SearchError { reason: "InvalidRegex" }` is the only failure. An empty query, a book filter that matches nothing, and a text with no match are all a successful empty result.
- Hits arrive in book order, then offset order.

## Hits are version-bound

`Hit { bookId, stamp, from, to, address?, preview, pieces? }`. `from`/`to` are UTF-16 offsets into the revision named by `stamp`, the book's stamp at scan time. `preview` is display text only — the containing line (of the reading, for a reading hit) narrowed to about 90 characters — and must never be parsed back into coordinates. (`Hit` also declares an optional `projected`; no scan sets it.)

`pieces` appears only when a reading hit maps back to more than **one** source piece, which means it spans markup the reading dropped; `from`/`to` are then the first piece, so anything that only wants somewhere to scroll to still works. Such a hit is **not replaceable**: `planReplace` returns `null` and `replaceInBook` refuses it as `Stale`. That is a rule, not a limitation — the markup between the pieces either survives the replacement or does not, and only the person editing knows which.

## Where a hit is

`address` is the [Address](../glossary.md) the hit's first piece sits in — `PHM 1:5`, `JUD 1:1-2` inside a bridge, the hull `1-5` inside `\v 1,3,5`, `PSA intro` — from Location's inverse lookup (`addressAt` in `src/core/location/locate.ts`) over the TOC of an analysis. Search reads no marker and parses nothing: the CALLER supplies analyses through `Options.analysisOf(id)`, keyed by the id the text arrived under.

- **Who supplies.** `/find` answers a project book with ProjectAnalysis' held parse and a bound reference with a parse of its exact text, made on first need and kept for the life of the screen (ProjectAnalysis holds none for references).
- **When it is missing.** An analysis is used only when it `describesExactly` the text scanned; otherwise, or when none is supplied, the hits still arrive, with no `address`. A book being typed in is the usual case, and nothing a reader sees depends on it: an excerpt card is labelled from its own analysis (`core/excerpts`). There is no fallback scanner.
- **Cost.** `analysisOf` is asked at most once per text per call, and only for a text with a hit, so N hits are one lookup plus N binary searches over one TOC (`tocViewOf` is kept per dish). A reference with no hit is never parsed.

## References

`findInReferences(readings, references: BoundReference[], query, options?)` searches `BoundReference { id, text }` — the resources `ProjectAnalysis` registered with their text. `ReferenceHit { source, projected, preview, address?, from, to }` is a **separate shape from `Hit`, deliberately**: it carries no `SourceStamp`, and `from`/`to` are offsets into the reference's text, somewhere to highlight and never somewhere to write. A reference hit that could be mistaken for an editable one is the bug this separation exists to prevent.

`/find` resolves each hit's Address against the project's own book (`refOccurrences`, below) and draws the reference hit above the project's matching verse card — paired verse by verse over both Addresses, so a bridge on either side still pairs — read-only, with no Edit, no Open in editor and no staleness badge. A reference hit with no Address has no card to sit on.

**Registration is not automatic.** `ProjectAnalysis.attachReferences(refs)` registers the books, and `src/app/workflows/references.ts` resolves the Library's `source` and `reference` bindings into texts and calls it. The set is REPLACED on each call and cleared when a project is attached. A project with nothing bound has no Reference scope: the segment on `/find` is disabled with the reason as its tooltip.

## Replace

Find offers Replace all behind the Advanced setting `find.enableReplaceAll`, off by default. The user enters literal replacement text, previews the scope and count, then explicitly applies. `src/routes/_app/project/$slug/find.tsx` preflights every book with `planReplace`, then loops the books itself, one `replaceInBook` each, and reports the actual count if a later book refuses. Reference searches are read-only.

- `planReplace(book, hits, insert) → readonly Change[] | null` — the change list for several hits of **one** book, in before-text coordinates and ascending order. `null` when the plan cannot be made: no hits, a hit from another book, a moved stamp, two overlapping hits, or a hit that spans markup.
- `replaceInBook(book, hits, insert) → Result<Receipt, Refusal>` — applies that plan as a single edit, or refuses `Refusal { rule: "search.replace", reason: "Stale" }`.

Every replacement goes through `book.apply(changes, "replace", UNTRUSTED)` — the one write path. Search does not judge markup: an untrusted replacement is examined by the editing phases exactly like a keystroke, so one that would break markup comes back as their `Refusal`.

## Excerpts

`src/core/excerpts/excerpts.ts` turns a flat list of occurrences into what the Find screen shows: one card per VERSE, in book order, with an outline beside them. It is pure core, so the same model serves the find results, the key-terms feed and the findings feed.

- `group(books: BookText[], hits: Occurrence[])` returns `{ groups, outline }`, where `BookText` is `{ bookId, text, analysis, label }`. A book with no hits is neither a group nor an outline row. Grouping is by verse, not by hit: three matches in Philemon 1:4 are one card with three highlights.
- **Every excerpt carries its `address`**, from `addressAt` at its verse anchor (or, before the first anchor, at its first hit: `intro`, or a chapter's head). `sid` is that Address's machine spelling (`addressCode`: `JUD 1:1-2`, `PSA 0`), a key and never parsed back. `label` is `BookText.label(address)`, the caller's display rule — in the app, `shell.location.label`: the project's name for the book, else the book's own `\h` or `\toc2` read off the engine's tokens (`bookHeading` in `src/core/galley/analysis.ts`), else English. A bridge reads as the bridge, "Jude 1:1-2". The group's `name` is the same rule for the whole book.
- An `Occurrence` is `bookId`/`from`/`to`, plus `pieces` when a match crossed markup, so a `Hit` and a term's occurrence arrive the same way.
- **Two coordinate systems.** `span` is the verse plus one either side, clamped to the chapter, in SOURCE offsets — what a satellite clips to. `text` is the projection of exactly that span and `marks` index into it; `hits` stay in source coordinates. `more` says whether the chapter has a verse above and below what is shown.
- **The projection is lazy.** `text`, `source`, `marks`, `verses` and `focus` are getters over a memoised `project()` call, because a virtualised feed of twenty thousand excerpts shows about twenty. Never object-spread an excerpt: that evaluates every getter.
- **Edit → satellite → funnel.** A card is read-only until Edit is clicked. Edit opens a CodeMirror satellite (`src/app/ui/excerpts/ExcerptEditor.tsx`) over the canonical Book, so every keystroke goes through the book's one write path and the editing phases judge it as they would in the editor.

Key terms reuse the excerpt feed under a term instead of a query; see [key terms (STET)](stet.md).

## Not yet

There is no scope narrower than "these books", and no search-and-replace history. A reference hit cannot be opened anywhere — there is no reader for a resource that is not a project book. Replacing a hit that spans markup is refused rather than offered as a choice; that choice belongs to the editor, not to a result card.
