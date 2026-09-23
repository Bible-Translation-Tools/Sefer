# The character inventory

`/inventory` answers one question: **how does this translation actually use its punctuation, its digits and its symbols, and what stands out?** Every number on the page is a fraction Sous published, and every judgement is a verse you can open. Nothing is scored.

The page is `src/app/ui/inventory/`; the reading is `src/core/findings/inventory.ts`; the value it reads is `ProjectAnalysis.inventory()`.

## What it reads

Two halves of the **same publication**, joined.

| half                        | what it is                                                                                                            | where it comes from                                       |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| the **pattern table**       | one row per `(glyph, channel, key)` with a numerator, a denominator, a share in basis points, a band and a book count | `FindingsSnapshot.patterns()`                             |
| the **Convention findings** | one row per convicted site, each naming a row of that table                                                           | the snapshot's per-book findings, `kind === "Convention"` |

Nothing else. The module never reads the project's text — the excerpt beside a flagged site is the only place text is touched, and that is the page's, for display (see [The flagged site's excerpt](#the-flagged-sites-excerpt)).

`inventory(snapshot, resolveBook)` pivots the table into one `Glyph` per code point:

- **What sits beside it** — `ExactNeighbor` (a specific character) and `PooledNeighbor` (one of the engine's eight pools: Quote, Bracket, Dash, Terminal, Separator, Digit, Symbol, Other).
- **How it attaches to words** — `Placement`, pivoted into one row per outer class (`Letter`, `Space`, `Digit`, `Nonletter`, `Edge`) with both sides. The wire carries `prev` and `next` as separate rows; the page shows them as two columns of one row, because "a comma is followed by a space 98% of the time" is one fact.
- **Run shape** — `RunShape`, pure or mixed, by length bucket.
- **Other signals** — `Rarity`, `LetterRun`, `SentenceStart`.
- **Flagged sites** — the Convention findings whose `convention.pattern` is one of that glyph's rows, with their reasons, their two stamps, and a reference derived through `siteRef`.

`resolveBook` is the **same** resolver `fromSnapshot` takes, so a site carries the Book's `SourceStamp` and the `EngineStamp` and answers freshness exactly as a `Finding` does. `siteRef(site, analysis)` fills a chapter and verse in only when the engine stamps agree — the rule `findings.navigateTarget` follows, for the same reason: a table of contents from another revision names the wrong verse with total confidence.

`Finding` carries an additive `pattern?: number` for a Sous Convention row, so the panel can ask for "the other sites of this pattern" without re-walking the snapshot. It is not a durable identity: the next publication renumbers the pattern table exactly as it renumbers findings, and the index is only meaningful against the snapshot `ProjectAnalysis` still holds.

## What "occurrences" means, and what it does not

The table column says **Sites**, and the page says in one line what it is.

Every channel publishes a fraction, and which half of it counts the glyph depends on the channel. A neighbour, `Placement` or `RunShape` row is judged against the glyph's own sites, so its **denominator** is the count. `Rarity` is judged against the whole corpus — its denominator is every scalar Sous measured — so its **numerator** is the count. `Glyph.sites` is the largest of those.

Its limits, plainly:

- It is **not a count of the text**. Nothing in this module re-reads a book. A count would be a second measurement of the project, and the one measurement should be the engine's.
- A glyph the engine measured on only **one narrow channel** reports that channel's population and nothing wider.
- **The table is not a census.** Sous emits a pattern row when a channel has a claim to make about a glyph, not one row per character in the project. On a small corpus that can mean the inventory contains _only the convicted characters_ — which is exactly what the `fixtures/small-nt` project produces: eleven pattern rows over ten glyphs, nine of them `Rarity`, every one of them flagged. A short table is not a tidy project, and the page says so above the list rather than letting the reader infer it.

## What is not shown

- **The word channels.** `Casing`, `WordLength` and `Doubled` judge a word, carry a 64-bit word hash instead of a scalar, and read `glyph === 0` off the wire. Folding them into a "code point zero" row would invent a character that does not exist, so `inventory()` keeps them in `wordPatterns` and the page reports their count in a footer card. A word-level view is a different page.
- **The other Sous lanes.** Hygiene, Presence, SourceCopy and LengthProportionality say nothing about a glyph's convention; they belong to `/findings`.
- **A UTF-8 publication's sites.** The patterns survive — a share and a denominator are coordinate-free — but the flagged sites are dropped, exactly as `fromSnapshot` drops such a publication whole. An offset in the wrong space points at the wrong bytes.

## Where it is computed

`ProjectAnalysis.inventory()` is memoised beside `findings()` and invalidated by the same `invalidateCaches()`, so it is recomputed when a publication lands and never on the keystroke path. The page reads it from the shell's `inventory` store, which a Publication replaces, like every other derived screen; it holds no subscription of its own (see [the application shell](shell.md), "The Solid/Book boundary").

## The page

`src/routes/_app/project/$slug/inventory.tsx` is a `createFileRoute` and a `<ShellGate>`, like every other route. The screen is three parts:

- a filter row — a text box that accepts a character, a name or a `U+` code; an `All | Flagged | Quiet` lens; and a pool select over the engine's own eight names, classified from the code point (a glyph's own `PooledNeighbor` rows classify its _neighbours_, so the filter needs a classifier rather than a lookup);
- the glyph table, most sites first, the character set in the scripture family in a tinted tile because a comma and a maqaf are three pixels apart in a UI sans;
- the detail card, one sub-table per channel group, and the flagged sites with the convicted character marked inside a quotation of the reading.

Each pattern row with convictions carries a toggle that narrows the flagged list to that one pattern; the secondary action hands the same question to `/findings` as `sous.convention.<Channel>`, through the router — an `<a href>` would be a full load, and the open Project would go with it.

Three empty states, because they are three different sentences: no project; a project whose corpus has not been published yet ("Analyzing…", distinguished by the snapshot's own book count being zero); and a publication that carries no glyph patterns at all.

## The flagged site's excerpt

The quotation beside a flagged site is the **reading**, not the raw USFM — the same projection the Find cards show, through `quote` in [`src/core/excerpts/excerpts.ts`](../../src/core/excerpts/excerpts.ts).

It quoted the canonical USFM until 2026-09-15, and that was the wrong text for this page in particular: every row read as `…\v 12 word, word…` on a page whose whole subject is how the translation punctuates its sentences. `quote` projects a window of source around the engine's offset, and because `project` keeps one source offset per output character, the `<mark>` lands on the projected character the engine actually convicted — no second measurement, no offset arithmetic in the component.

**The fallback is per site, not per page.** When the convicted span has no character in the projection at all — it is inside a marker name, an attribute value, or a control character the reading drops — there is nothing honest to mark, and quoting the surrounding words would put the mark on the wrong thing. `Quotation.projected` is `false` for that row, and only that row: it falls back to the raw slice, is set in mono rather than the scripture face, and is labelled **in markup**. A reader can tell the two apart before reading either.

The offsets themselves are never touched. "Go" still navigates by the engine's own span, and `siteRef` still refuses to name a chapter and verse unless the stamps agree.

## What the engine would need to publish for a full census

The page is shaped for more than the current Sous branch emits. To become a character-by-character inventory rather than a conviction list it needs, per glyph in the corpus (not only convicted ones): total sites and per-book spread; the full neighbour table on both sides; placement against Letter / Space / Digit / Nonletter / Edge; cluster (run) shapes; and an API that enumerates every site of a glyph or of a pattern, not only the convicted ones. `sitesOfGlyph(inventory, codePoint)` — the underlined sites the snapshot does carry, "show the other places this character is flagged" — is parked until then ([parked code](../../planning/04-parked/parked.md)).

**Still open at scripture-kitchen v0.1.0.** That tag closed most of Sefer's engine asks and deliberately not this one — Will did not build the census (`planning/01-discussing/engine-asks-2026-09-14.md`, item 2). What v0.1.0 did add here is two more convicting channels, `LetterRun` and `SentenceStart`, both on by default and both already in the lists above; they add rows to the table without changing what the table is.
