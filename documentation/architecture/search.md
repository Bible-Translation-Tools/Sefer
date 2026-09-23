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
- `Options { limit?, books? }`. `limit` is a total across all books and omitted means no bound; `books` narrows the scan to those `BookId`s. The bound is on the question instead: `MINIMUM_QUERY = 2`, measured on a whole Bible, below which the screen does not search — a single character is a quarter of a million hits nobody can read, and a capped count would answer "how many are there" wrongly.
- `SearchError { reason: "InvalidRegex" }` is the only failure. An empty query, a book filter that matches nothing, and a text with no match are all a successful empty result.
- Hits arrive in book order, then offset order.

## Hits are version-bound

`Hit { bookId, stamp, from, to, ref, preview, pieces? }`. `from`/`to` are UTF-16 offsets into the revision named by `stamp`, the book's stamp at scan time. `preview` is display text only — the containing line (of the reading, for a reading hit) narrowed to about 90 characters — and must never be parsed back into coordinates. (`Hit` also declares an optional `projected`; no scan sets it.)

`pieces` appears only when a reading hit maps back to more than **one** source piece, which means it spans markup the reading dropped; `from`/`to` are then the first piece, so anything that only wants somewhere to scroll to still works. Such a hit is **not replaceable**: `planReplace` returns `null` and `replaceInBook` refuses it as `Stale`. That is a rule, not a limitation — the markup between the pieces either survives the replacement or does not, and only the person editing knows which.

`ref` comes from a marker table built once per book per call over the source's `\c`/`\v` markers (`buildRefTable`, then `refFrom` by binary search). It is a marker scan, not a parse, and it is the current limitation: the Location work is meant to replace it with the engine's TOC.

## References

`findInReferences(readings, references: BoundReference[], query, options?)` searches `BoundReference { id, text }` — the resources `ProjectAnalysis` registered with their text. `ReferenceHit { source, projected, preview, ref, from, to }` is a **separate shape from `Hit`, deliberately**: it carries no `SourceStamp`, and `from`/`to` are offsets into the reference's text, somewhere to highlight and never somewhere to write. A reference hit that could be mistaken for an editable one is the bug this separation exists to prevent.

`/find` draws a reference hit above the project's matching verse card — paired by book, chapter and verse, walking the card's verse range so a bridge on one side still pairs — read-only, with no Edit, no Open in editor and no staleness badge.

**Registration is not automatic.** `ProjectAnalysis.attachReferences(refs)` registers the books, and `src/app/workflows/references.ts` resolves the Library's `source` and `reference` bindings into texts and calls it. The set is REPLACED on each call and cleared when a project is attached. A project with nothing bound has no Reference scope: the segment on `/find` is disabled with the reason as its tooltip.

## Replace

Find offers Replace all behind the Advanced setting `find.enableReplaceAll`, off by default. The user enters literal replacement text, previews the scope and count, then explicitly applies. `src/routes/_app/project/$slug/find.tsx` preflights every book with `planReplace`, then loops the books itself, one `replaceInBook` each, and reports the actual count if a later book refuses. Reference searches are read-only.

- `planReplace(book, hits, insert) → readonly Change[] | null` — the change list for several hits of **one** book, in before-text coordinates and ascending order. `null` when the plan cannot be made: no hits, a hit from another book, a moved stamp, two overlapping hits, or a hit that spans markup.
- `replaceInBook(book, hits, insert) → Result<Receipt, Refusal>` — applies that plan as a single edit, or refuses `Refusal { rule: "search.replace", reason: "Stale" }`.

Every replacement goes through `book.apply(changes, "replace", UNTRUSTED)` — the one write path. Search does not judge markup: an untrusted replacement is examined by the editing phases exactly like a keystroke, so one that would break markup comes back as their `Refusal`.

## Excerpts

`src/core/excerpts/excerpts.ts` turns a flat list of occurrences into what the Find screen shows: one card per VERSE, in book order, with an outline beside them. It is pure core, so the same model serves the find results, the key-terms feed and the findings feed.

- `group(books: BookText[], hits: Occurrence[])` returns `{ groups, outline }`, where `BookText` is `{ bookId, text, analysis }`. A book with no hits is neither a group nor an outline row. Grouping is by verse, not by hit: three matches in Philemon 1:4 are one card with three highlights.
- An `Occurrence` is `bookId`/`from`/`to`, plus `pieces` when a match crossed markup, so a `Hit` and a term's occurrence arrive the same way.
- **Two coordinate systems.** `span` is the verse plus one either side, clamped to the chapter, in SOURCE offsets — what a satellite clips to. `text` is the projection of exactly that span and `marks` index into it; `hits` stay in source coordinates. `more` says whether the chapter has a verse above and below what is shown.
- **The projection is lazy.** `text`, `source`, `marks`, `verses` and `focus` are getters over a memoised `project()` call, because a virtualised feed of twenty thousand excerpts shows about twenty. Never object-spread an excerpt: that evaluates every getter.
- **Edit → satellite → funnel.** A card is read-only until Edit is clicked. Edit opens a CodeMirror satellite (`src/app/ui/excerpts/ExcerptEditor.tsx`) over the canonical Book, so every keystroke goes through the book's one write path and the editing phases judge it as they would in the editor.

Key terms reuse the excerpt feed under a term instead of a query; see [key terms (STET)](stet.md).

## Not yet

There is no scope narrower than "these books", and no search-and-replace history. A reference hit cannot be opened anywhere — there is no reader for a resource that is not a project book. Replacing a hit that spans markup is refused rather than offered as a choice; that choice belongs to the editor, not to a result card.
