# Findings, project analysis, and fixes

Galley produces diagnostics in the same call that produces structure. This is where they go, and what may be done with them. Slices 13–15; the sinks table is [the editor and save seams](../../planning/00-ideas/v2-editor-and-save-seams.md) §2.

## The sinks, as they now exist

| sink | who | when | code |
|---|---|---|---|
| 1a · editor inline, Onion | the editor's lint recipe | synchronously, every keystroke, from the current state's analysis | `src/editor` |
| 1b · editor inline, Sous | `sousField`, pushed in by `showCorpusFindings` | when ProjectAnalysis publishes — never on the keystroke path | `src/editor`, fed from `src/app/ui/BookEditor.tsx` |
| 2 · Findings, per book | `fromAnalysis(bookId, analysis, stamp)` | off the keystroke path for other books; from the editor's own analysis for the instantiated one | `src/core/findings/` |
| 3 · ProjectAnalysis | `census`, `findings`, `crossBook`, `watch` | debounced ~150 ms after a publish; once per project open | `src/core/analysis/` |
| 4 · Observability | `note('analyze', …, 'BOOK diag=N err=E', bookId)` | per analysis | inside ProjectAnalysis and Galley |
| 5 · Fixes | `preview(finding, book, analysis)` | on demand, per finding | `src/core/fixes/` |

Sink 4 carries counts and codes only. A diagnostic's message quotes the document, so it lives in sinks 1, 2 and 5 and never in telemetry.

### Why sink 1 has two halves

The editor can recompute Onion's diagnostics for free — it already parses the document on every keystroke, and rebuilding the marks from the current state is what makes an inline mark structurally unable to be stale. It can recompute nothing of Sous: a corpus finding is a judgement about the project, produced by a whole-corpus publication that happens ~150 ms after the reader stops typing, on another thread on desktop. So the two halves flow in opposite directions and meet at one `linter`:

- **Onion** is pulled, synchronously, by `findings(state)`.
- **Sous** is pushed, by `BookEditor` — which already holds the one `book.changes` subscription and already calls `projectAnalysis.supply` — on every `ProjectAnalysis.watch()` event. It filters `crossBook()` to this book and drops anything `stale`, so only findings stamped with the revision on screen are handed over.

`sousField` then enforces the same rule from the other side: **any document change empties it**. Nothing maps a corpus offset through a `ChangeSet`, because the result would be an underline in a plausible but unmeasured place — exactly the failure the two stamps exist to prevent. The next publication refills it within the scheduler's quiet window, and until then the reader sees Onion's marks alone.

The field is declared to the linter through `needsRefresh`, not through `forceLinting` alone. CodeMirror's lint plugin schedules a run on a document change and `force()` only shortens a run it has already scheduled — and a corpus publication arrives *after* that run finished, by construction. `needsRefresh` is what makes a second, document-independent source legal at all.

Both halves are drawn by the one `linter`, so there is one gutter, one popover and one keyboard order over them. `source` is what distinguishes them for a reader: `onion/<code>` or `sous/<code>`. Only the Onion half carries an action — `fixes.preview` refuses a Sous finding `NotEngineFix`, and offering a button that always refuses would be a lie in the interface. The action applies through the bound view, which is `book.fromView`, which is the one write path: Undo, Save, Recovery and the panel all hear the receipt. It re-analyzes the live document first and discards the edits if the engine stamp moved.

## The one shape

`Finding { id, bookId, severity, code, producer, message, from, to, stamp, engine, fix? }` — `src/core/findings/finding.ts` is the only place either producer is translated into it.

- `severity` is `error | warning | info`. Onion's `hint` folds into `info`; a code that says nothing at the document's declared `\usfm` version (and the whole `form` category) is **dropped**, so the census counts stay honest.
- Sous carries no severity ladder at all, so Sefer's presentation policy is stated once in `corpusSeverity`: Hygiene is an error (a control character or a conflict marker is a defect in the file), Presence is a warning, everything statistical is info.
- `code` is the catalogue name for Onion (`unknown-marker`) and `sous.<lane>[.<class>]` for Sous (`sous.hygiene.C0Control`, `sous.convention.Rarity`).
- `id` is `producer:bookId:code:from-to`. **Row indices are not durable identities** — the next publication renumbers everything — so identity is semantic, and two rows with the same code at the same span are one finding.
- `from`/`to` are UTF-16 offsets into the text the stamps name, exactly as the engine reported them. Nothing shifts an offset. A Sous publication whose `coordinateSpace` is UTF-8 is dropped whole rather than mixed with UTF-16 findings.
- `fix` is a **pointer** (`{ kind: 'engine', diagnosticIndex }`), not the edits: a panel of four hundred findings resolves none of them.
- `Finding` carries no `Ref`. A chapter:verse address is only derivable from a table of contents, and one from another revision names the wrong verse with total confidence — so `navigateTarget(finding, analysis?)` fills `ref` in only when the caller hands over the analysis the finding was computed from.

## Freshness

Two stamps, two scopes. `stamp` is the Book's `SourceStamp`: within one Book's lifetime the revision decides, and `stale(finding, book)` is the check a panel makes before navigating. `engine` is the `EngineStamp` (the engine's xxh3 hash plus length): it survives across Book lifetimes and is what `Fixes.preview` reads before it will touch text. Length alone never decides.

`ProjectAnalysis.fresh(bookId, stamp)` answers whether the held analysis is the one for that stamp. A book with no analysis reports zero counts in the census — read `fresh` to tell that apart from a clean book.

## What ProjectAnalysis holds

One project's worth of stamped, disposable analyses, plus the last Galley publication. It exists because a translator must not have to open sixty-six files to learn whether the project has errors (vision §11.1), so `attach(project)` analyzes **every** book once at project open and registers each as a corpus target.

It takes **two** services, because on desktop they are two processes: `Galley` for the synchronous per-book `analyze`, which never leaves the webview, and `CorpusEngine` for the whole-corpus half (`update`, `remove`, `publish`). Every `yield*` on a corpus call is therefore the point where the work leaves the JS thread — natively with rayon on desktop, still in-process on Web. See [Galley](galley.md), "Two doors, one publication", including the cold paths that remain. A refused corpus call **retains**, exactly as a refused parse does: the note is recorded, the previous snapshot stands, and the next pass registers the book again.

- `attach` subscribes to every `book.changes` and to `project.changed` (a seat swap replaces the object holding the canonical text, so the old subscription is dead). A change marks the book stale and arms one scheduling fiber.
- **One fiber, not one per book.** It waits for ~150 ms of quiet (or 1 s from the start of a burst), then re-analyzes every pending book and publishes the corpus **once** — `publish()` is whole-corpus and a snapshot replaces the previous one entirely, so per-book publication would judge the corpus n times for one gesture.
- The instantiated book is never analyzed twice: the editor hands its current parse in through `supply(bookId, analysis)`, which composition wires. The scheduler then owes that book only its corpus registration. A supplied analysis is used only if it still `describesExactly` the Book's text.
- An engine refusal **retains**: the last analysis stays, the entry stays stale, `note('analyze', 'failed', …)` records it. A failed refresh never reports a clean project (vision §11.4).
- `findings()` is memoised until something changes; `crossBook()` is the Sous half alone.
- The `analyze.publish` span's note carries the engine kind (`wasm` or `native`), so a reading of the observability ring says which door ran and how long it took there.

Filtering and grouping are presentation policy. `findings.ts` orders findings by book (project order), then severity, then position; hiding a category is the shell's business and does not alter analysis truth.

## Filters and views

`src/core/findings/filter.ts` is that presentation policy, written as pure functions over the one shape — no Effect, no Solid, no host. It is in core because it is a total function over `Finding` that a satellite panel, a diff view or a headless report would want identically; it takes the freshness answer as a callback (`isStale`) because only the shell holds the Books.

- `applyFilter(findings, filter, isStale?)` is **subtractive only, and never re-orders**. The caller's order is `list`'s order, and a filter that re-sorted would quietly override it. `isStale` is consulted only when `hideStale` is set, so the default panel pays for no freshness checks.
- `FindingsFilter` has two kinds of field. `severities` and `producers` are allow-lists (absent = hidden). `books` and `codes` are `null` for "no restriction", which is **not** `[]` — an empty list matches nothing, and the helper honours that literally; the chip row normalises a set the reader has emptied back to `null` so the UI cannot strand them on a blank screen.
- `facets(findings)` counts every filterable value over the **unfiltered** list. A chip whose count fell to zero because the chip itself is off would be a chip nobody could turn back on.
- `groupBy(findings, 'book' | 'code' | 'severity')` returns ordered groups, each keeping its own order. Group order differs per axis on purpose: books in project order (first appearance — sorting ids would put 3 John before Jude), severity on the ladder, codes by descending count so the code to deal with first is at the top.

**A filter never deletes a finding.** Nothing on the panel writes to `ProjectAnalysis`; the census, the inline marks and the corpus counts are untouched by a chip. The header therefore always reads "N of TOTAL shown", so a filtered panel can never present as a clean project (vision §11.4), and stale rows are dimmed with their badge rather than dropped unless the reader asks.

What persists and what does not (vision §11.4: "category and severity filters should be persistent user preferences"):

| part | where it lives | why |
|---|---|---|
| `severities`, `producers`, `hideStale` | `findings.filter` in Settings, declared in `src/app/settings.ts` | lasting choices about how someone reads |
| `text` | a session signal on `/findings` | a remembered text filter presents as an empty project |
| `books` | a session signal | a remembered book set hides the book you just opened |
| the view (by book, by code, by severity, or flat) | a session signal | a way of looking at what is on screen now |

`findings.filter` is a `Schema.Struct`, and the `/settings` form draws one widget per `kind` (`boolean | string | number`) — so the key is registered in `shellKeys` but deliberately left out of `shellSettings`. Its editor is the panel's own filter toolbar (`src/app/ui/panels/FindingsFilters.tsx`), which seeds from `Settings.get`, writes through `Settings.set` on every click (no debounce — a click is a deliberate act) and stays live on a fiber over `settings.changes`, exactly as `ProjectContext` does for `editor.preferChapterView`.

Core cannot navigate. `navigateTarget` returns a value; the shell calls `project.instantiate(bookId)`, mounts a view and scrolls the semantic span into place. The span stays exact even when visual mode hides the markup it covers (vision §11.3) — a presentation anchor is the view's decision, never a substitution here, because the same span is what a fix would edit.

## The panel

`/findings` is sink 2 on screen: `src/app/ui/panels/FindingsPanel.tsx`, the filter toolbar above it, and nothing else. Eight decisions are worth stating.

**It is a virtualized multibuffer, like Find.** Will, 2026-09-15: *"the Findings page should be a virtualized multibuffer like Find; it is slow to render today."* It is now the same machinery — `src/app/ui/primitives/VirtualList.tsx`, extracted from `ExcerptList` when this page needed it, over `@tanstack/virtual-core`. The measurement, on this project's own findings multiplied to a synthetic 7,296: the un-windowed list built **4,992 rows** in the DOM and took **~647 ms** to re-render on a filter change; the windowed one builds **18** and takes **~63 ms**. On the fixture's own 76 it is 52 rows and ~13 ms against 18 rows and ~19 ms — the same, which is the point: the windowing is for the project that has four hundred findings in one book, and it costs nothing on the one that has four. Book headers are sticky and carry their count; only the rows are windowed, keyed by the finding's own id so a height correction re-positions a row rather than re-creating it.

**A row quotes the verse it is about.** `quote()` (`core/excerpts`) projects a window around the finding's span and places the span back inside it, marked — so a row shows the sentence a translator would read rather than an offset they have to go and look up. It is offered only when `ProjectAnalysis` still holds the analysis the finding was measured against (same `docLen`, same `sourceHash`); otherwise the row shows its message and no quotation, because a quotation from another revision would quote the wrong words with total confidence. When the span has no character in the projection at all — inside a marker name, an attribute, a control character — `quote` says so (`projected: false`) and the row shows the raw USFM slice in a monospace face instead of quietly showing a different character.

**The filters are dropdowns, in one row.** Severity, Producer, Books and Codes each fold into a Popover; the text filter and "Hide stale" stay inline, because a text filter is the control a reader reaches for without planning to and a search box behind a menu is a search box nobody uses. Each trigger says what its group is narrowed to ("Severity 2 of 3", "Books all") and wears the brand tint when it is hiding something — a folded filter that does not say it is filtering is exactly how a reader comes to believe a project is clean. They were four open chip groups down the left of the page, and on a sixty-six-book project the book chips alone pushed the findings below the fold.

**`?code=` and `?pattern=` are accepted, and neither is authoritative.** `/inventory` links here with "the other sites of this convention"; the link was already being sent and was silently dropped, because a route that does not validate a search param does not receive it. `code` seeds the Codes filter — a seed, not a lock: the chips are still the reader's and "All codes" clears it. `pattern` is different and deliberately is NOT a `FindingsFilter` field: it is an address another screen hands over for one visit, not a preference anybody sets, so it narrows the list the panel calls "all" and the header's "N of TOTAL shown" stays honest about the question that was asked. A banner says the list is narrowed and offers the way out.

**Grouping is the view, and the count is always over findings.** `groupBy` returns the sections; "flat" is one unlabelled section rather than a second rendering path, because the row markup is the part worth having once. A "by book" header shows the id and the human name beside it (`bookName`, which reads the project's own metadata first, exactly as the sidebar does), and the header's badge counts FINDINGS, never rows.

**A run of identical rows folds.** Consecutive findings in a group with the same `code` AND the same `message` collapse to one row carrying `× N`, which expands on click — seventy-six rows of "\s5 is not a known marker" is a wall, not a report. Only CONSECUTIVE ones fold, so the fold never re-orders and never reaches across a group, and it is purely presentational: the header count, the chip counts and the census are untouched. The keyboard cursor walks the VISIBLE rows, so `j`/`k` move over what the eye sees, and Enter unfolds a folded row where it opens an ordinary one. The cursor scrolls itself into view through `VirtualList`'s `focus`, which answers from the virtualizer's geometry — the row the cursor lands on may not be rendered at all, and that is exactly when a `scrollIntoView` on a DOM node cannot work and a computed offset can.

**A row's reference is derived, or it is not shown.** Each row names where it is by calling `navigateTarget(finding, analysis)` with the analysis `ProjectAnalysis` holds for that book. That fills `ref` in only when the analysis still describes the very text the finding was measured against, so a fresh row reads "PHM 1:4" and a row whose analysis has moved shows the raw offset instead. Nothing on this screen ever guesses a verse: a chapter and verse from another revision would name the wrong place with total confidence, which is the failure the two stamps exist to prevent.

**Fix is offered only where it can be honoured.** The button appears when the finding carries a `fix` pointer, and pressing it computes `fixes.preview` on demand — a panel of four hundred findings resolves none of them until someone asks. A preview computed from text the book has since moved past is refused (`Stale`), and `fixes.apply` goes through `book.apply`, the one write path, so a fix from the panel is the same event a fix from the editor is. A book nobody has opened has no Book to apply to, and the panel says so rather than failing quietly.

## What fixes can and cannot do

Sefer writes no USFM transformations. Onion attaches the edits to the diagnostic that found the problem, and `src/core/fixes/fixes.ts` only carries them to `book.apply(changes, 'fix', trustedBy('fix'))` — the one write path, so Undo, Save, Recovery and the panel all learn about the edit.

- `preview` refuses `Stale` unless the analysis `describesExactly` the Book's current text **and** matches the finding's engine stamp **and** the diagnostic at that index still carries the same code. Three checks because they catch different mistakes; a same-length edit passes a length check alone.
- `apply` refuses `Stale` if the Book's revision moved since the preview. `applyAll(previews, book)` puts one book's set through a single `apply` — one Undo step, one receipt — and one stale or foreign member refuses the whole set rather than applying it partially.
- Whether the edit is admissible at all is the Book's business: an editor-backed Book runs its phases, and a fix that would break structure is refused by the rules, not by a check here.
- `formatBook`/`applyFormat` are the same machinery over the engine's whole-book transaction — see [Format](#format) below.
- Sous findings never carry edits — they measure. `preview` refuses them `NotEngineFix`, and sink 1 offers them no button for the same reason.
- Inside the editor the door is the bound view, not `fixes.apply`: `applyFix` dispatches the engine's edits with `trusted.of('lint-fix')`, and because the view was bound with `dispatchTransactions: (trs) => book.fromView(view, trs)` that IS `book.apply` — the same phases, the same receipt. The freshness check is the engine stamp rather than the revision: the editor re-analyzes the live document and compares hashes, so a same-length edit made while the tooltip was open is caught. `fixes.preview`/`apply` remain the door for a surface with no view, which is the panel.

## Format

`format.book` and `format.project` apply **the engine's** whole-book transaction, and Sefer writes no part of it. Engine-asks item 1 landed in scripture-kitchen v0.1.0; `Fixes.FORMAT_DOOR` and its refusal are gone.

`Fixes.formatBook(galley, book)` calls the module's `formatEdits(text, opts)` and hands back a `FormatPreview { bookId, changes, stamp, empty }`. `Fixes.applyFormat(preview, book)` puts the changes through one `book.apply(changes, 'format', trustedBy('format'))` after checking the Book has not moved since the preview — the same staleness rule a fix preview obeys, for the same reason: the offsets would otherwise land in text nobody looked at.

It is a `FormatPreview` and not a `FixPreview`. Format is not a repair offered at a site and there is no finding behind it; giving it a fabricated `Finding` so it could share a type would be a lie in the shape of a convenience. What the two do share is the vocabulary a caller needs — the changes, and the stamp that says which text they are offsets into.

**"Already formatted" is now a sentence Sefer can say honestly.** `FormatPreview.empty` is what the formatter had nothing to do; the command reports it rather than applying an empty transaction, which would spend a revision and an Undo step on nothing.

### Why edits, and not the formatted document

The module also exports `format(text, opts)`, which answers the whole rewritten string. Sefer deliberately uses `formatEdits`:

- **One Undo step that a reviewer can read.** The edits go through the Book as ONE transaction — one revision, one receipt for Save, Recovery, ProjectAnalysis and the panel. A replaced document would undo correctly too, and would appear in a diff as a single change covering every character in the book.
- **The Book still judges it.** An editor-backed Book runs its phases over the changes like any other write. The origin is trusted, so the keyboard guards stand aside the way they do for a fix-it, but nothing skips the one write path.

`format.project` runs the same call across books through `MultiBook.runAcrossBooks('format', …)`: one `apply` per book with origin `project.format`, which the editor-backed Book isolates in its history — so Undo takes back that book's share of the operation and nothing the reader typed around it.

### Why there is still no formatter in Sefer

Unchanged, and worth keeping written down. `onion::format` merges **two** edit sets — the lint rows flagged `formatter` in the catalogue, and the FORM channel (`Severity::Form`) that `lint` never reaches — colliding them by row order, first writer wins. Sefer can see the first half and cannot see the second at all, so a TypeScript pass would reproduce half of format and silently diverge on the rest. Two formatters that disagree about scripture is the worst bug available here.

The options are not offered either. `FormatOpts` has a dozen switches (`verse_breaks`, `collapse_blank_lines`, `block_marker_own_line`, `remove_markers`, `repairs`…) and Sefer passes none of them: the engine's own defaults are what "Format" means, and choosing among them is a settings surface nobody has designed. `src/core/galley/format.ts` types all of them, so the day someone designs it the plumbing is one object.

## Sous's new lanes

v0.1.0 gave Sous two more rule codes and two more channels, and `corpusCode`/`corpusSeverity` in `src/core/findings/finding.ts` name all of them:

| wire | code | severity | on by default |
|---|---|---|---|
| `Presence` | `sous.presence.Missing` / `.Extra` / `.Empty` | `warning` | yes |
| `SourceCopy` | `sous.source-copy` | `info` | **no** |
| channel `LetterRun` | `sous.convention.LetterRun` | `info` | yes |
| channel `SentenceStart` | `sous.convention.SentenceStart` | `info` | yes |

Presence is a `warning` because a verse coverage gap is usually real and occasionally deliberate; everything statistical stays `info`. Source-copy is off in the engine's defaults because a borrowed proper name would otherwise be a finding in every verse that carries one, and turning it on needs references registered with their text — `Galley.wordlessReferences()` counts the ones that were not.

The two new channels are convictions like any other and reach `/inventory` through the same pattern table; see [Character inventory](inventory.md).

The header's snapshot id now changes when the settings change, not only when the text does. That costs `ProjectAnalysis` nothing today: its finding, cross-book and inventory caches are keyed on nothing at all and are dropped wholesale whenever a publication lands or a book changes. A settings surface that flipped a lane WITHOUT touching any text would have to invalidate them by hand; nothing calls `setSettings` yet, and this is the note for whoever writes the first caller.
