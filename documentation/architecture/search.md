# Search

`src/core/search/search.ts` is project-wide Find and the Replace behind it (seams §3.10). It takes `readonly Book[]` rather than a Project so the result browser, a satellite window and a script can each call it with whatever books they hold.

## Three doors, two shapes

- `findProjected(corpus, books, query, options?)` — **the default.** Searches the engine's verse-text projection, what the reader sees in visual mode, and places every hit back in the source. Asynchronous, because the corpus is (on desktop it is a different process).
- `find(books, query, options?)` — the raw scan of canonical USFM text. Pure, synchronous, no engine. Kept for the two things the projection cannot answer: a **regex** query, and a search meant to reach the markup itself.
- `findInReferences(corpus, query, options?)` — the project's **bound** source and reference resources, through the engine's `references` scope.

The first two produce the same `Hit`, so `resolveHit`, `replace`, `replaceInBook` and `planReplace` are written once and neither door has a private replace path. The third produces a `ReferenceHit`, and the difference is the point — see below.

Which door: regex → raw, always (the engine's find is literal `memmem`; `findProjected` refuses a `regex` query as `InvalidRegex` rather than silently searching for the pattern's characters). Deliberate markup search → raw. Everything a translator means by "find" → projected.

## Find, through the engine

`findProjected(corpus, books, query, options?) → Effect<readonly Hit[], SearchError>`.

- Matching is the engine's: literal, case-insensitive by default under the simple lowercase fold, and `wholeWord` under the words rule the engine restates in `galley/src/find.md` — not this module's `\p{L}\p{N}_` edge test.
- Markup can neither hide a match nor manufacture one. A needle inside a footnote is not found; a marker that happens to contain the needle's letters is not a hit.
- Each hit carries `projected` (the reading's coordinates) as well as `from`/`to` (the source's). A hit that crosses markup the projection dropped carries `pieces`, one range per contiguous run — see below.
- The books given are what binds the result: a hit for a book not in `books` is dropped, and each hit carries the stamp its book holds at the time of the call, exactly as a raw hit does.
- The corpus must have been told about the books. `ProjectAnalysis.attach` registers every book of a project as it opens, so a find on an open project sees them all; a book the corpus never received simply has no hits.
- `SearchError { reason: "Engine" }` carries a corpus failure's reason and description — one error type, because a caller shows both the same way.

## Find, in the project's references

`findInReferences(corpus, query, options?) → Effect<readonly ReferenceHit[], SearchError>`. Engine-asks item 3b, closed by scripture-kitchen v0.1.0: `findAll` takes a scope, and a reference registered with `keepText` retains the text, the mask and the projection a target does, so it can be searched at all.

`ReferenceHit { source, projected, preview }` is a **separate shape from `Hit`, deliberately.** A `Hit` carries a `SourceStamp` and offsets into a Book's canonical text, so a card can refuse when the book has moved and an edit can land exactly where the match was. A reference has none of that available and needs none of it: there is no Book, no revision to compare against, and nothing to edit. So a `ReferenceHit` carries what a reader can use — which resource file it came from, where in the reading the match sits, and the projected text around it — and deliberately **no offset into any text Sefer could write to**. A reference hit that could be mistaken for an editable one is the bug this separation exists to prevent. `/find` renders them as readings rather than excerpts for the same reason: no Edit, no Open in editor, no staleness badge.

**Registration is not automatic.** `ProjectAnalysis.attachReferences(refs)` registers the books, and `src/app/workflows/references.ts` is what resolves the Library's `source` and `reference` bindings into texts and calls it. It is separate from `attach` because a reference is a Library binding and the Library and the FileSystem are the shell's services; requiring them inside ProjectAnalysis would put two host-facing Layers behind every composition of it for a feature two screens use. The set is REPLACED on each call and cleared when a project is attached — a resource bound to the project we just left is not a reference for the one we just opened.

A project with nothing bound has no Reference scope at all: the segment on `/find` is disabled with the reason as its tooltip, because a scope with nothing in it answers "no matches" to a question it never asked.

## Find, raw

`find(books, query, options?) → Result<readonly Hit[], SearchError>`.

- `Query { text, caseSensitive?, wholeWord?, regex? }`. `text` is a literal unless `regex` is set, in which case it is a `RegExp` source. Matching is case-insensitive by default. `wholeWord` is checked on the characters either side of the match (`\p{L}\p{N}_`), so it works for literals and regexes alike and for non-ASCII scripts, where `\b` would not.
- `Options { limit = 500, books? }`. `limit` is a total across all books, not per book; `books` narrows the scan to those `BookId`s.
- `SearchError { reason: "InvalidRegex" }` is the only failure — a pattern `RegExp` will not accept. An empty query, a book filter that matches nothing, and a text with no match are all a successful empty result.
- Hits arrive in book order, then offset order.

Each scan is a fresh `String`/`RegExp` walk of every canonical text. There is no index and no cache: a corpus-sized scan of plain strings is fast, and keeping an index correct against every keystroke would cost more than the scan does.

## Hits are version-bound

`Hit { bookId, stamp, from, to, ref, preview, projected?, pieces? }`. `from`/`to` are UTF-16 offsets into the revision named by `stamp`, which is the book's stamp at scan time. `preview` is display text only — the containing line narrowed to about 90 characters around the match, with `…` on truncated edges — and must never be parsed back into coordinates.

`projected` and `pieces` are present only on hits from `findProjected`. `pieces` appears only when there is more than **one** source piece, which means the hit spans markup the projection dropped; `from`/`to` are then the FIRST piece, so anything that only wants somewhere to scroll to still works. `spansMarkup(hit)` is the question, and a hit that answers yes is **not replaceable** here: `replace` refuses it as `Refusal { rule: "search.replace", reason: "SpansMarkup" }` and `planReplace` returns `null`. That is a rule, not a limitation — the markup between the pieces either survives the replacement or does not, and only the person editing knows which. The engine's job was to say the gap is there.

`resolveHit(hit, books)` returns `{ book, from, to }` or `null`. It is `null` when the book is no longer in `books` or its revision has moved since the scan. Every action on a result card goes through it first, which is how a stale card refuses instead of editing the wrong range (vision §12.2: "every result is version-bound").

## References

`refAt(text, pos, book?) → Ref` scans the `\c`/`\v` markers before `pos`. `chapter` is `0` for front matter before the first `\c`; `verse` is absent until a `\v` opens in that chapter. `find` builds one marker table per book per call and binary-searches it, so many hits cost one scan rather than one scan each.

This is a marker scan, not a parse. Galley's TOC is the real answer: when ProjectAnalysis (slice 15) can hand search an analysis per book, `refAt` should read the TOC instead. Until then a book with no analysis still needs a reference for its card.

## Replace — and no global Replace All

Sefer does not offer a project-wide Replace All over a Bible (vision §12.2). The result browser presents editable result cards and the user replaces one match at a time; nothing in this module walks the corpus and rewrites it.

- `replace(hit, insert, books) → Result<Receipt, Refusal>` — one match. Refused as `Refusal { rule: "search.replace", reason: "Stale" }` when the hit no longer resolves, or `"SpansMarkup"` when it crosses dropped markup.
- `replaceInBook(book, hits, insert)` — several hits of **one** book as a single edit, so the book publishes one receipt and the phases judge the change list together.
- `planReplace(book, hits, insert) → readonly Change[] | null` — the change list `replaceInBook` uses, in before-text coordinates and ascending order, shaped for MultiBook's `runAcrossBooks(label, plan)`, which asks per book. `null` when the plan cannot be made: no hits, a hit from another book, a moved stamp, two overlapping hits, or a hit that spans markup. `runAcrossBooks` reads `null` as "this book is not part of the operation", which is the right answer in all of those cases.

Every replacement goes through `book.apply(changes, "replace", UNTRUSTED)` — the one write path. Search does not judge markup: an untrusted replacement is examined by the editing phases exactly like a keystroke, so one that would break markup comes back as their `Refusal`.

## Excerpts

`src/core/excerpts/excerpts.ts` turns a flat list of `Hit`s into what the Find screen actually shows: one card per VERSE, in book order, with an outline beside them. It is pure core — text, an analysis, hits in, excerpts out — so the same model serves the find results, the key-terms feed and anything later that presents a passage out of context.

- `group(books, hits)` returns `{ groups, outline }`. A group is a book, in the caller's order; a book with no hits is neither a group nor an outline row. Grouping is by VERSE and not by hit: three matches in Philemon 1:4 are one card with three highlights.
- **Two coordinate systems, and the module holds both.** `span` is the verse plus one either side, clamped to the chapter, in SOURCE offsets — that is what a satellite clips to. `text` is the `project`ion of exactly that span (markers, designators and note bodies dropped, the same reading `findProjected` searches) and `marks` index into `text`. `hits` stay in source coordinates, because that is what Replace and "open in editor" need. `focus` says where the excerpt's own verse sits in `text`, which is how a card dims the context around it.
- An `Occurrence` is `bookId`/`from`/`to` and nothing else, so a `Hit` from either search door and a term's occurrence arrive the same way.
- **Edit → satellite → funnel.** A card is read-only until Edit is clicked. Edit opens a CodeMirror satellite (`src/app/ui/excerpts/ExcerptEditor.tsx`) over the canonical Book — not over a copy of the text — so every keystroke goes through the book's one write path and the editing phases judge it exactly as they would in the editor. An accepted edit bumps the shell and the search is re-run against what the text now says.
- **The STET feed** (`src/app/workflows/stet.ts`) is the same list under a term instead of a query: a key term selects a whole-word search, and the screen shows the term's glosses beside the excerpts. The terms are a stand-in until a key-terms resource can be bound, and the screen says so.

## Not yet

There is no scope narrower than "these books", and no search-and-replace history. A reference hit cannot be opened anywhere — there is no reader for a resource that is not a project book, so a hit is a preview and a file name. Replacing a hit that spans markup is refused rather than offered as a choice between "keep the markup" and "drop it"; that choice belongs to the editor, not to a result card.

`refAt` still reads `\c`/`\v` markers rather than the TOC, on both doors.
