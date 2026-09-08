# Search

`src/core/search/search.ts` is project-wide Find and the Replace behind it (seams §3.10). It is pure and synchronous: plain functions over `Book`s, no service, no Layer, no engine. It takes `readonly Book[]` rather than a Project so the result browser, a satellite window and a script can each call it with whatever books they hold.

## Find

`find(books, query, options?) → Result<readonly Hit[], SearchError>`.

- `Query { text, caseSensitive?, wholeWord?, regex? }`. `text` is a literal unless `regex` is set, in which case it is a `RegExp` source. Matching is case-insensitive by default. `wholeWord` is checked on the characters either side of the match (`\p{L}\p{N}_`), so it works for literals and regexes alike and for non-ASCII scripts, where `\b` would not.
- `Options { limit = 500, books? }`. `limit` is a total across all books, not per book; `books` narrows the scan to those `BookId`s.
- `SearchError { reason: "InvalidRegex" }` is the only failure — a pattern `RegExp` will not accept. An empty query, a book filter that matches nothing, and a text with no match are all a successful empty result.
- Hits arrive in book order, then offset order.

Each scan is a fresh `String`/`RegExp` walk of every canonical text. There is no index and no cache: a corpus-sized scan of plain strings is fast, and keeping an index correct against every keystroke would cost more than the scan does.

## Hits are version-bound

`Hit { bookId, stamp, from, to, ref, preview }`. `from`/`to` are UTF-16 offsets into the revision named by `stamp`, which is the book's stamp at scan time. `preview` is display text only — the containing line narrowed to about 90 characters around the match, with `…` on truncated edges — and must never be parsed back into coordinates.

`resolveHit(hit, books)` returns `{ book, from, to }` or `null`. It is `null` when the book is no longer in `books` or its revision has moved since the scan. Every action on a result card goes through it first, which is how a stale card refuses instead of editing the wrong range (vision §12.2: "every result is version-bound").

## References

`refAt(text, pos, book?) → Ref` scans the `\c`/`\v` markers before `pos`. `chapter` is `0` for front matter before the first `\c`; `verse` is absent until a `\v` opens in that chapter. `find` builds one marker table per book per call and binary-searches it, so many hits cost one scan rather than one scan each.

This is a marker scan, not a parse. Galley's TOC is the real answer: when ProjectAnalysis (slice 15) can hand search an analysis per book, `refAt` should read the TOC instead. Until then a book with no analysis still needs a reference for its card.

## Replace — and no global Replace All

Sefer does not offer a project-wide Replace All over a Bible (vision §12.2). The result browser presents editable result cards and the user replaces one match at a time; nothing in this module walks the corpus and rewrites it.

- `replace(hit, insert, books) → Result<Receipt, Refusal>` — one match. Refused as `Refusal { rule: "search.replace", reason: "Stale" }` when the hit no longer resolves.
- `replaceInBook(book, hits, insert)` — several hits of **one** book as a single edit, so the book publishes one receipt and the phases judge the change list together.
- `planReplace(book, hits, insert) → readonly Change[] | null` — the change list `replaceInBook` uses, in before-text coordinates and ascending order, shaped for MultiBook's `runAcrossBooks(label, plan)`, which asks per book. `null` when the plan cannot be made: no hits, a hit from another book, a moved stamp, or two overlapping hits. `runAcrossBooks` reads `null` as "this book is not part of the operation", which is the right answer in all of those cases.

Every replacement goes through `book.apply(changes, "replace", UNTRUSTED)` — the one write path. Search does not judge markup: an untrusted replacement is examined by the editing phases exactly like a keystroke, so one that would break markup comes back as their `Refusal`.

## Not yet

Search sees only canonical USFM text. Visual search across intervening markup needs Onion-derived projections (vision §12.1), and searching source/reference resources by role needs Project's resource roles; neither is wired. There is no scope narrower than "these books", and no search-and-replace history.
