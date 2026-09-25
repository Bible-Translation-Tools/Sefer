# Key terms (STET)

Status: this document describes code that exists, and says plainly which parts of it are a stand-in.

STET — "let it stand", the proofreader's mark — names two jobs in Sefer. This document is about the one that shipped: **key terms**, the screen at `/project/$slug/terms` where a reviewer walks a guide's list of spiritual terms and, for each verse the guide records, compares a frozen source reading against the project's own. Transferring FORMATTING from a source book to a target that has the same words was once planned as STET's other half; it shipped instead as the Overlay ("Match formatting from source"), a command on the text rather than a view here. See [findings](findings.md#overlay).

## Two panes, not a toggle

Will's decision on the gap list ([design direction](design-direction.md), "Decisions on the gap list", item 5) is that Find and Key terms are separate panes with similar UI. So:

- `find` is Find. No segmented header, no term list, no `mode` search param.
- `terms` is Key terms, gated on `ShellGate` like every screen that needs services. Its search params are `term`, `q` and `locale`.
- `find?mode=stet` is answered rather than dropped: `beforeLoad` on `find` reads the raw search string and throws `redirect({ to: "/project/$slug/terms", params, search: {} })`, so a saved link still lands somewhere sensible.

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
TermOccurrence{ address, sid, sourceText?, spans?, curated }
```

- **`address`** is the one verse the guide names, as an Address (`versesAddress`, equal ends). `sid` stays alongside it as the guide's own key into `referenceVerses` and `glossRanges`.
- **`id`** is the English label slugged, with a counter on collision. The upstream data has no stable identifier; the previous application keyed on the display label and warned when two collided. A slug survives a URL, which is what `terms?term=grace` needs.
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

It lives in `src/core/excerpts/excerpts.ts` because it is a fact about the project's text, not about the guide, and it does no arithmetic of its own: where a verse is, is Location's answer.

- **`refOccurrences(book, addresses)`** is the whole mapping, and the feed: for each verse Address of this book it asks `resolve` (`src/core/location/locate.ts`) over the book's TOC (`tocViewOf`), and answers with one **zero-width** occurrence where each found span starts — a verse anchor — deduplicated and in document order. A bridge answers for every verse it spans, so a reference to `JUD 1:2` is found inside a `\v 1-2` the project happens to have — dropping it would be the one case where the reader most wants to see how the target differs — and the card reads "Jude 1:1-2". A verse list's holes are honoured: `JUD 1:2` is missing from `\v 1,3`.

Zero width is the honest span. A search hit knows which characters matched; a reference does not — the guide's offsets index into the guide's own reading, and this project may put the term elsewhere in the verse, or render it with another word entirely, which is the very thing the reviewer is here to judge. So the **target card carries no highlight** and the **source card carries the guide's**. The excerpt's `focus` still dims the verses either side, so the reference is still visually located.

References the book does not have are skipped rather than reported: a guide covers the whole canon and a project covers a few books. So is one `resolve` calls ambiguous (malformed text with two anchors for the verse), rather than guessing which card it belongs on. Two references landing on one anchor — both verses of a bridge — become one occurrence, because they are one card.

Everything after that — grouping by verse sid, the per-book headers, the outline with counts, Edit → satellite, Open in editor — is `group()` and `ExcerptList`, unchanged.

## What the source card shows

`sourceReadings` in `src/app/workflows/stet.ts` resolves, once per term rather than once per card, what the upper card of each pair shows. Three answers in a fixed order:

1. the guide's frozen reading for that sid, with its precomputed highlights;
2. otherwise a resource bound to the project under the `source` role (`Library.readBook`, then the engine's TOC for where the verse is and where its number ends);
3. otherwise nothing — and the card prints "No source text bound" rather than showing the project's own text twice and calling one of them a source.

The Library pass runs only over what the guide did not answer, and short-circuits entirely when no source resource is bound, which is the dev fixture's case.

## What is stubbed

- **`done` counts are always 0.** Marking an occurrence settled needs a store that survives a reload, and nothing in Sefer keeps one yet. The term list says so in a muted line rather than showing progress that is not being recorded.
- **The guide is a fixture.** A key-terms guide is properly a Library resource under the `glossary` role, or a remote guides API. The port exists so that swapping the layer is the only change.
- **No replace, no in-editor highlight.** The same non-goals the previous application had. An edit happens through a card's Edit button, in the satellite, where the editing phases judge it like any other keystroke.
- **A bridge card loses its guide reading.** The source card is looked up by the excerpt's `sid`, so a target card at `JUD 1:1-2` finds nothing under the guide's `JUD 1:2` and says "No source text bound". It did the same before the cards were labelled by Address; the fix is to look up by the occurrence's Address, not the card's.

## Match formatting moved

This route used to carry a second view, `/terms?view=format`, with a two-column
source/target comparison and a confirm dialog before an overlay was applied.
It is gone. Overlay is now a command on the text being read — toolbar and
palette, scoped to the chapter at the cursor, the book, or every book, with no
preview because Undo is the preview. [Findings › Overlay](findings.md#overlay)
describes it.

## Where things are

| Path                                      | What                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------- |
| `src/routes/_app/project/$slug/terms.tsx` | The screen: guide → references → occurrences → feed, all off the URL. |
| `src/routes/_app/project/$slug/find.tsx`  | Find only, plus the `?mode=stet` redirect.                            |
| `src/core/stet/stet.ts`                   | Envelope schema, `Term`/`TermOccurrence`, the `StetCatalog` port.     |
| `src/core/stet/fixture.ts`                | The committed guides as a layer, one dynamic chunk per locale.        |
| `src/core/excerpts/excerpts.ts`           | `refOccurrences` — Address → project mapping, through `resolve`.      |
| `src/app/ui/excerpts/feed.ts`             | `createExcerptFeed`, shared by Find and Key terms.                    |
| `src/app/ui/excerpts/StetView.tsx`        | The two-column view and the source/target pair.                       |
| `src/app/workflows/stet.ts`               | `keyTermGuides`, `keyTerms`, `sourceReadings`.                        |
| `src/app/workflows/references.ts`         | Library bindings → texts → `ProjectAnalysis.attachReferences`.        |
| `src/core/galley/overlay.ts`              | The overlay wire: addresses, skeletons, the report.                   |
| `fixtures/stet/`                          | The four committed guide files and their provenance.                  |
