# Key terms (STET)

Status: this document describes code that exists, and says plainly which parts of it are a stand-in.

STET — "let it stand", the proofreader's mark — names two jobs in Sefer. This document is about the one that shipped: **key terms**, the screen at `/terms` where a reviewer walks a guide's list of spiritual terms and, for each verse the guide records, compares a frozen source reading against the project's own. The other half, transferring FORMATTING from a source book to a target that has the same words (`matchFormatting`, `stetCompare` in `src/app/workflows/stet.ts`), is still a stub that dies rather than returning an empty answer.

## Two panes, not a toggle

Key terms was a `mode=stet` branch on `/find` and is not any more. Will's decision on the gap list (`planning/03-ui/design-direction.md`, "Decisions on the gap list", item 5) is that Find and Key terms are separate panes with similar UI. So:

- `/find` is Find. No segmented header, no term list, no `mode` search param.
- `/terms` is Key terms, gated on `ShellGate` like every screen that needs services.
- `/find?mode=stet` is answered rather than dropped: `beforeLoad` on `/find` reads the raw search string and throws `redirect({ to: "/terms" })`, so a saved link still lands somewhere sensible.

What the two panes share is everything below the hits: `createExcerptFeed` (`src/app/ui/excerpts/feed.ts`) owns which books to analyse, how a card expands, what Edit seats, where Open in editor goes, and what happens after an accepted edit. Each route supplies only its own `Occurrence[]` — Find's from a search, Key terms' from a guide mapped onto the project.

## The catalogue port

`src/core/stet/stet.ts` is the trust boundary and the flattening.

A guide is a **frozen, self-contained snapshot**, not something this application derives. An offline generator pins a Gateway Language translation at a commit, pulls the plain reading of every verse a term is recorded in, and precomputes the offsets inside those readings where the term's glosses matched. The envelope is decoded through an Effect Schema before a single field reaches a caller:

```
StetEnvelope
  schemaVersion  1
  locale         "en"
  reference      { provenanceId, displayName, sourceUrl? }
  referenceVerses  { "PHM 1:3": "Grace to you and peace …", … }   // deduped across terms
  terms[]        { term, englishTerm, strongs[], definition,
                   subsetVerses[], exhaustiveVerses[], glosses[],
                   glossRanges: { "PHM 1:3": [[0, 5]], … } }
```

`termsOf` joins that into the shape a caller wants — the term with its occurrences and their text attached, so no view has to hold two collections that must agree:

```
Term          { id, term, englishTerm, glosses[], definition, strongs?, occurrences[], done }
TermOccurrence{ book, chapter, verse, sid, sourceText?, spans?, curated }
```

- **`id`** is the English label slugged, with a counter on collision. The upstream data has no stable identifier; the previous application keyed on the display label and warned when two collided. A slug survives a URL, which is what `/terms?term=grace` needs.
- **`occurrences`** is the curated evaluation set unioned with the exhaustive recorded set, deduped, in the guide's own order. `curated` marks which is which — the old application's "exhaustive" toggle, as a property rather than a mode.
- **`spans`** index into `sourceText`, never into the project's text. They are the guide's precomputed gloss offsets, bounds-checked on the way through.
- **`done`** is 0. See "What is stubbed".

The port itself is four reads and no notion of a project:

```ts
interface StetCatalogService {
  guides(): Effect<readonly Guide[], StetError>;
  terms(locale?): Effect<readonly Term[], StetError>;
  term(id, locale?): Effect<Option<Term>, StetError>;
  occurrences(termId, locale?): Effect<readonly TermOccurrence[], StetError>;
}
```

### The fixture layer

`src/core/stet/fixture.ts` serves the committed guides under `fixtures/stet/`, the way `src/core/fixture/smallNt.ts` serves the dev project — the bytes are the repository's, imported rather than fetched. Two differences, both because a guide is a thousand times the size of a fixture book:

- The `?raw` imports are **dynamic**, so Vite emits one chunk per locale and only the locale that was asked for is fetched. A static import would put four megabytes into the main bundle for a screen most sessions never open.
- The decoded result is **cached per locale**. Decoding is a `JSON.parse` of a megabyte plus a schema walk over five thousand verses; it is not something to redo because a reader clicked a second term.

The layer is provided in `src/app/workflows/stet.ts` (`withCatalog`), not in `src/app/services.ts`. That is deliberate: nothing about the application's boot should depend on a megabyte of guide JSON. Swapping the fixture for a Library resource bound under the `glossary` role, or for a remote guides API, is that one `Effect.provide`.

### Provenance

`fixtures/stet/README.md` carries it in full: four files copied verbatim from `public/stet/` in `scripture-editor-proto-2`, generated by `build-stet-catalog.mjs` in `stetDataGenerator`, from three pinned WA-Catalog ULB commits (`en` `8baaf207…`, `es-419` `c54e36d1…`, `pt-br` `f63e8b13…`). The verse text is the Unlocked Literal Bible and the definitions are translationWords, both CC BY-SA 4.0.

## How an occurrence maps onto the project

This is the only genuinely new arithmetic, and it lives in `src/core/excerpts/excerpts.ts` because it is a fact about the project's text, not about the guide.

- **`refOccurrences(book, refs)`** is the whole mapping, and the feed: it walks the verse spans Onion's table of contents gives (`verseSpans`), once per book, and answers with one **zero-width** occurrence at each verse of `refs` that this book actually has, in document order. A bridge answers for every verse it spans, so a reference to `JUD 1:2` is found inside a `\v 1-2` the project happens to have — dropping it would be the one case where the reader most wants to see how the target differs.

Zero width is the honest span. A search hit knows which characters matched; a reference does not — the guide's offsets index into the guide's own reading, and this project may put the term elsewhere in the verse, or render it with another word entirely, which is the very thing the reviewer is here to judge. So the **target card carries no highlight** and the **source card carries the guide's**. The excerpt's `focus` still dims the verses either side, so the reference is still visually located.

References the book does not have are skipped rather than reported: a guide covers the whole canon and a project covers a few books. Two references landing in one verse bridge become one occurrence, because they are one card. Everything after that — grouping by verse sid, the per-book headers, the outline with counts, Edit → satellite, Open in editor — is `group()` and `ExcerptList`, unchanged.

## What the source card shows

`sourceReadings` in `src/app/workflows/stet.ts` resolves, once per term rather than once per card, what the upper card of each pair shows. Three answers in a fixed order:

1. the guide's frozen reading for that sid, with its precomputed highlights;
2. otherwise a resource bound to the project under the `source` role (`Library.lookup`);
3. otherwise nothing — and the card prints "No source text bound" rather than showing the project's own text twice and calling one of them a source.

The Library pass runs only over what the guide did not answer, and short-circuits entirely when no source resource is bound, which is the dev fixture's case.

## What is stubbed

- **`done` counts are always 0.** Marking an occurrence settled needs a store that survives a reload, and nothing in Sefer keeps one yet. The term list says so in a muted line rather than showing progress that is not being recorded.
- **The guide is a fixture.** A key-terms guide is properly a Library resource under the `glossary` role, or a remote guides API. The port exists so that swapping the layer is the only change.
- **No replace, no in-editor highlight.** The same non-goals the previous application had. An edit happens through a card's Edit button, in the satellite, where the editing phases judge it like any other keystroke.

## Match formatting

`/terms?view=format` is the second view on this route. It shares the premise (a
source bound to this project) and a reader moves between the two in one
sitting; it is a segmented control rather than a route because neither half is
somewhere anybody links to directly.

The job is the reverse of drafting. The words are already right; what has to
cross is the SHAPE — where the paragraphs break, which lines are poetry, how far
each is indented — from the source the translator worked from to a target that
came back as one undifferentiated run.

**It is the engine's, and that is the point.** `matchFormatting` was an
`Effect.die` stub whose note said the alignment rules were the domain owner's
and this file must not invent them. It still must not, and since
scripture-kitchen v0.1.0 it does not have to: the overlay doors answer which
markers transfer, what happens at a verse the target split or merged, and how a
mismatch is reported (engine-asks item 3, closed). What is left for the
workflow is the join — register both sides, ask for both skeletons and the
transaction. See [galley.md](galley.md), "Match formatting".

### Two columns, one address

The two texts have different words and different lengths, so nothing about them
can be matched by offset. What they share is a **block address** —
`(sid, where, ordinal)`: which verse, whether the block leads the verse or sits
inside it, and which one of those it is. Selecting a block on either side
highlights the block at the same address on the other.

The **marker is deliberately not part of the match.** A `\q1` here against a
`\q2` there is precisely the difference a translator opened this view to see,
and matching on the name would hide it by never pairing them. A block with no
counterpart is marked instead.

Both skeletons are fetched once per edit (~0.4 ms each) and matched in
TypeScript, so the highlight costs nothing per cursor move.
`targetNodeFor`/`sourceNodeFor` are for one-off questions and are an order of
magnitude dearer.

### What Apply says before it writes

`overlayReport` is not decoration. Three of its four lists change what a reader
should expect, and the summary row says all three:

- **inserted, empty.** A block the source has INSIDE a verse arrives with no
  words, because where a verse's text splits is unknowable across languages.
  The file gets an empty block and the translator moves the line into it.
  Nothing is invented — and a reader who was not told would read that as a
  failed transfer.
- **removed.** A block the target has and the source does not is taken out, and
  its text joins the block above it. No words are lost; the shape is.
- **unpaired.** A verse with no counterpart — absent, bridged, ambiguous — is
  left alone entirely.

The confirm dialog names the **chapters** rather than counting the edits: "this
will change 14 places" is not a sentence anyone can act on. Apply is one
`book.apply(edits, 'format', trustedBy('format'))` — one revision, one receipt,
one Undo step. An overlay a reader regrets is one keystroke from gone, which is
the only reason it is safe to offer.

### What it needs, and what it does not have

A bound `source` or `reference` resource whose file name carries the open
book's code. `src/app/workflows/references.ts` resolves the binding;
`fixtures/small-nt` has none, so the dev fixture shows the empty state until a
resource is imported and bound.

The source is paired to the target **by book code in the file name**, the same
loose rule `Library.lookup` uses. Resource layouts vary and the manifest that
would answer authoritatively is YAML.

Registration goes to the wasm **handle**, which since the `CorpusEngine` port was deleted is the only door there is.
On Web those are the same object; on desktop the corpus is a separate process
and the handle has never been told about either book, so without this the view
would work on Web and quietly not on desktop. It costs the source's text being
resident twice on desktop, for a view a translator opens deliberately.

## Where things are

| Path | What |
| --- | --- |
| `src/routes/terms.tsx` | The screen: guide → references → occurrences → feed, all off the URL. |
| `src/routes/find.tsx` | Find only, plus the `?mode=stet` redirect. |
| `src/core/stet/stet.ts` | Envelope schema, `Term`/`TermOccurrence`, the `StetCatalog` port. |
| `src/core/stet/fixture.ts` | The committed guides as a layer, one dynamic chunk per locale. |
| `src/core/excerpts/excerpts.ts` | `verseSpans`, `refOccurrences` — the reference → project mapping. |
| `src/app/ui/excerpts/feed.ts` | `createExcerptFeed`, shared by Find and Key terms. |
| `src/app/ui/excerpts/StetView.tsx` | The two-column view and the source/target pair. |
| `src/app/ui/excerpts/MatchFormattingView.tsx` | The two block columns, the report badges, the confirm dialog. |
| `src/app/workflows/stet.ts` | `keyTerms`, `keyTermGuides`, `sourceReadings`, `matchFormatting`. |
| `src/app/workflows/references.ts` | Library bindings → texts → `ProjectAnalysis.attachReferences`. |
| `src/core/galley/overlay.ts` | The overlay wire: addresses, skeletons, the report. |
| `fixtures/stet/` | The four committed guide files and their provenance. |
