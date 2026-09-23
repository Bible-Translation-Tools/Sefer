# Editor primitives and composition consistency

**Status:** working audit, 2026-09-19. Read-only review of the current tree and scripture-kitchen v0.1.4, informed by two independent agent passes. This is a proposed order of consistency work, not implementation authorization.

## Aim

New UI recipes—reference tagger, Find/STET excerpts, navigation, comments, paired references, and a future aligned multibuffer—should compose a small set of clear behaviors. They should not each decide how to parse a reference, locate a verse, prove an offset fresh, or attach a surface to canonical text.

The composition to make reliable is:

```text
input → parse reference → resolve against named exact texts → location outcomes
      → excerpt / preview / navigate / aligned panes
      → per-surface projection, clip, marks, follow policy, and write capability
```

`Book` remains the only writable canonical USFM text. A surface's `editable` facet does not make a foreign reference resource writable. Layout is a recipe; ownership and source coordinates are lower-level contracts.

## Ownership list, in priority order

### 1. Canonical reference and location values — Sefer core

Treat `src/core/location` as the proposed cohesive boundary, with small internal pieces rather than one service that owns UI behavior. It should compose (1) parsing text into a semantic address under an explicit input grammar, (2) validating its shape and optionally matching a book name against a supplied name catalogue, (3) locating an offset/selection in stamped source text, (4) resolving an address in one named, stamped resource, and (5) mapping or re-resolving a historical location. These operations should share types and outcomes but remain independently callable. A caller that already has a typed reference should not parse a string, and a window with a known source range should not need a scripture reference at all.

The module returns facts: address, source range or pieces, source identity, and `found`/`missing`/`ambiguous`/`stale` or invalid-input outcomes where applicable. It does not decide whether a surface may open, whether a resource is editable, how far to degrade a scroll target, or whether the result becomes a popup, hyperlink, reference panel, navigation command, or aligned column. Those are caller and editor policies. In particular, projected CodeMirror offsets must be converted to canonical source coordinates at the editor boundary before Location sees them; a discontinuous projection stays in pieces. Book/resource identity and coordinate space must travel with any reusable resolved span.

`src/core/reference/reference.ts`'s `Reference { bookId, chapter?, verse? }` and `src/core/book/book.ts`'s `Ref { book, chapter, verse? }` are near-duplicates. The proposed complete verse reference is `{ book, chapter, verseStart, verseEnd }`: one book and one chapter, positive verse numbers, `verseStart <= verseEnd`. A single verse has equal ends; disjoint references are a list of these values, including references to different books. A cross-chapter request can also be a list. The reference names a semantic place and does not assert that any text contains it. Keep chapter-only navigation as a parser outcome with the usable fields present, not a forced verse reference.

The navigation parser can remain forgiving and accept a unique abbreviation or a chapter alone. A prose matcher needs a complete recognized book name/slug, chapter and verse or verse range, strict token boundaries, and the matched text span. Both should receive possible book names from the English canon and project metadata, sharing name validation without sharing their acceptance policies. Whether matching uses a generated regex or another index is an implementation choice to measure, not a public primitive.

A resolved reference is a richer value: the semantic reference plus the specific text/resource, UTF-16 source span or disjoint pieces, and text identity. This is the useful superset for a hover preview or clipped view; it does not put a checksum into a reference parsed from prose. A batch resolver should retain `found` or `not found` for every requested reference in every requested text. If malformed data offers duplicate anchors for the same address, report that condition rather than silently choose one. STET can filter misses; an aligned multibuffer cannot silently lose a column.

Resolution normally uses the current analysis. A hyperlink may re-resolve on activation; an edit must verify the exact resolved text before writing. Scroll restoration can degrade from an exact span to verse to chapter when earlier text moved. A whole-book stamp cheaply detects that *something* changed; an optional chapter/selected-span fingerprint might avoid needless remapping when unrelated text changes, but it cannot make an old absolute offset valid. Re-resolve or map the offset first, then check the destination.

The inverse lookup belongs beside resolution in the same Sefer core module: `referenceAt(analysis, sourceOffset)` returns a typed address, and `referencesCovering(analysis, sourceRange)` returns the addresses covered by a selection. Use half-open source ranges; for a nonempty selection, inspect `to - 1` for its last included character. A selection can cover multiple verses or chapters, so its semantic result may be a list, while the original exact range remains available. Keep the original resolved location immutable and derive a current, optionally mapped location when needed. Mapping accepted edits while the Book is open and lazy re-resolution against a later analysis should share the same freshness and ambiguity outcomes. A deleted or uncertain current location does not erase the original address.

**Why now:** comments, navigation, prose links, Find, and multibuffer alignment all need this answer. A stamp alone is insufficient if the consumer does not also know which resource the offset indexes.

### 2. Structural TOC lookup — Kitchen facts, Sefer adapter

Installed Kitchen already exposes a binary-search `Toc.at(pos)` for source offset → chapter/verse, and chapter/verse rows including bridge bounds. Its public `locate(text, utf16)` returns a formatted label such as `MRK 6:3`; it may clamp an out-of-bounds offset. It is useful for display, but it is not the typed inverse lookup or a substitute for an explicit missing/invalid outcome. Do not parse that label back into a reference or invent another binary search. `src/core/galley` remains Kitchen's sole importer and should publish the narrow Sefer-facing read operations.

**Cheap upstream Kitchen/Galley ask:** export its existing xxh3-64 as a free function for arbitrary canonical UTF-8 text/bytes, with a specified encoding and return type. Keep the analysis header's whole-source hash accessible through the Sefer adapter; when a TOC is used apart from its analysis, expose the source hash and length that stamp the text it indexes. A chapter or selected-span hash can then be computed from that exact text slice and the free function. It cannot be derived from the whole-book hash. This hash door should not block the first Sefer resolver, and Sefer should not quietly introduce a competing FNV-like identity. Scripture Burrito's existing MD5 checksum serves a different external format contract.

The reverse direction, reference → exact row/span, currently lives partly in `src/core/excerpts/excerpts.ts` as `verseAnchor`/`refOccurrences`. First establish one canonical Sefer resolver over `Analysis.dish.toc`. **Then** decide whether a general forward lookup is a stable Kitchen operation worth moving upstream. Here “prove useful upstream” means its semantics are independent of Sefer's project metadata, UI omission policy, and resource bindings; it does not mean keep multiple Sefer implementations while waiting.

Delete the provisional `\c`/`\v` scanners in `src/core/search/search.ts` and `src/core/resources/library.ts` once the same resolver can answer their cases. Preserve Library's responsibility for finding and reading a resource file; remove its scripture-location policy. `src/core/excerpts` keeps context expansion, projection, lazy display values, and grouping, but consumes resolved locations rather than owning the reference join.

**Gate:** bridges, front matter, missing verses, duplicate anchors in malformed data, and UTF-16 offsets give the same honest result to Find, STET, Library, and navigation.

### 3. Projection/mode extension bundle — `src/editor`

`BookEditor.tsx`, `recipes/reference.ts`, and `ExcerptEditor.tsx` each assemble `assignment`, `modeFacet`, and `EditorView.editorAttributes`. Give that three-part rule one small editor utility, with an optional surface class. `ResultCard.tsx`, which added `cm-mode-regular` directly to `view.dom.classList`, was deleted on 2026-09-23 as dead code; nothing else mutates the editor's classes that way.

Keep `readingLayer` and `viewLayer` distinct. A note-body satellite intentionally does not install the regular reading projection because it would hide the note being edited. One universal `readingSurface()` bundle would make that case harder to express.

**Gate:** regular/USFM mode and the mode class stay in step across canonical editor, reference, excerpt, and result-card surfaces after transactions and focus changes.

### 4. Range and chapter semantics — `src/editor`, with semantic location in core

Chapter clip (`editor/core/clip.ts`) has a visible extent and an editable extent. Satellite scope (`recipes/satellite.ts`) visually replaces text outside a range. Excerpt editor snaps a source span to line boundaries before using that scope. These should remain separately named contracts; a visual clip is not an edit guard.

Share narrow range calculations only where they remove repeated rules. Resolve a chapter by its displayed number/label when crossing resources: ordinals are local to one parsed text. The recipe still chooses whether a missing chapter clears a clip, leaves a pane alone, or reports failure. Scroll alignment (`start`, `center`, `nearest`) remains a recipe decision.

### 5. Canonical borrow protocol — `src/editor`, preserve distinct recipes

`Funnel` and `fromCanonical` already express the key invariant: a borrowed surface submits a change to the Book and applies text locally only when the accepted canonical change is published. Windows and satellites both follow it, but a direct comparison below does **not** justify one public `CanonicalMirror` yet. Consider a narrow internal helper only after its actual shared protocol and lifetime obligations are expressed by tests. `openWindow` and `mountSatellite` remain distinct recipes.

### 6. Multi-surface composition — application/UI recipes

Find/STET's multibuffer is a vertical list of excerpts. `ReferencePane` is a column of whole foreign books. A future N-column aligned view may combine resolved locations with a configurable set of surfaces. All three should consume the same location outcomes and surface capabilities, while retaining their own layout, follow/pin, missing-resource, and edit affordance rules. Do not introduce a universal multibuffer component to unify one list and one set of panes.

## Location audit: current answers and proposed seam

The following are current behaviors, not merely names that happen to contain “ref” or “location.” They ask either which scripture address contains an exact source position, where an address lands in a text, or whether a saved coordinate still describes that text.

| Current path | Question it answers today | Location contribution | Keep with caller |
| --- | --- | --- | --- |
| `core/reference/reference.ts` | Forgiving typed navigation input → project-held book/chapter/verse; prefixes choose by canon order | Shared name catalogue, grammar-specific parse result, typed address validation | Palette/sidebar acceptance and navigation |
| `core/search/search.ts` `buildRefTable`/`refAt`/`refFrom` | Raw or projected Find hit's first source offset → `Ref` using a private `\c`/`\v` scan | Stamped offset → structural address from Galley TOC | Regex/reading search, hit preview, replace rules |
| `core/excerpts/excerpts.ts` `verseAnchor`/`refOccurrences` | STET/Find reference → verse span; bridge references coalesce into one zero-width target occurrence | Address → source span, including bridge and missing outcomes | Card grouping, context expansion, zero-width target marks, omission policy |
| `core/resources/library.ts` `lookup` | Resource binding + `Ref` → passage, currently sliced by marker regex | Address → location in text after Library reads the book | File selection, I/O, resource registration, passage presentation |
| `core/findings/findings.ts` `navigateTarget` and `core/findings/inventory.ts` `siteRef` | Exact diagnostic/site offset → optional `Ref`, only after engine stamp matches | One exactness check and one offset → address lookup | Finding identity, severity, panel ordering, fixes |
| `app/ProjectContext.tsx` `showReference` | Parsed book/chapter/verse → open book, find chapter label, then verse row and scroll | Resolve address against the newly focused text and report how far it resolves | Routing, pending intent, clip preference, scroll and fallback policy |
| `editor/recipes/whereAmI.ts`, `LocationBar`, `ReferencePane` | Visible/caret chapter and corresponding place in a bound book | Translate a source position to semantic chapter/verse; resolve it in another resource | Viewport measurement, follow/pin, clip, highlight and scroll |
| `editor/recipes/pairing.ts`, `core/galley/overlay.ts` | Pair a verse or a more precise `(sid, where, ordinal)` block across texts | Reuse verse address resolution where appropriate | Block correspondence and paint; a block address is not reducible to a verse reference |
| `core/search/search.ts` `resolveHit`, `core/findings/finding.ts` `stale`, `core/fixes` | Is a stored offset still safe for this action? | Shared source-identity vocabulary and exactness predicate | Search hit retention, publication lifecycle, fix admission |

This inventory does **not** call every range a Location. `Occurrence` is a hit at exact characters; `Finding` is an engine-produced diagnostic; an `Excerpt` is a lazy display model; a window or satellite is an editor lifetime and transaction protocol. Location should serve them without absorbing their state or replacing their established authority. Existing project analysis already publishes current findings; mapping a comment anchor through edits is not a license to shift a Sous diagnostic instead of recomputing it.

### A small public contract to test before choosing files

The module name is a useful organizing proposal, not a mandate for one class or a stateful service. Its pure pieces might look like this; names and exact TypeScript shapes are provisional:

```ts
parseNavigation(input, names)       // permissive, may yield book/chapter only
matchProse(input, names)            // strict, returns matched text span(s)
validateAddress(candidate)          // positive, ordered, one-chapter verse range
at(analysis, sourceOffset)          // typed address or front/chapter-only/missing
covering(analysis, sourcePieces)     // ordered addresses, without filling gaps
resolve(analysis, address)          // source span(s) | missing | ambiguous
describeExactly(analysis, source)   // same source text, no coordinate guessing
```

`Reference` should mean an address independent of a particular translation. An exact `SourceLocation` should name its resource/book, coordinate space, span or pieces, and source identity; it may also carry a derived address. A persisted anchor can contain an immutable original `SourceLocation` plus an optional derived current location and attachment status. Do not make one mutable “superset Reference” whose checksum and offsets silently change while its apparent identity stays constant. The current `Ref` with chapter `0` usefully labels front matter; it should be an explicit located state, not pass the positive-number validation for a human verse reference.

`at` accepts an offset in `[0, text.length]` only after exact analysis/text agreement. The end-of-document caret may resolve to the final structural place, but an out-of-range offset should return invalid input rather than inherit Kitchen `locate`'s display-oriented clamping. `covering` accepts half-open ranges or disjoint retained source pieces. A zero-width caret asks `at(from)`; a nonempty range ending exactly at a verse boundary does not include the following verse. A structural verse bridge can answer several semantic verse numbers with one physical span. A selection whose start is in one chapter and end is in another yields ordered addresses or pieces, not a fabricated same-chapter range.

`resolve` takes one named text's current stamped analysis; a batch helper can apply it to a list of addresses and resources without hiding each result. Keep `missing book`, `missing chapter`, `missing verse`, duplicate/ambiguous structure, and unavailable analysis distinguishable at the boundary if consumers need different fallbacks. This does not require one union variant per screen. A semantic match may succeed even when the resource lacks the verse. A source span is reusable only with the identity of the exact text it indexes. Source revision is suitable inside one Book lifetime; Galley's hash plus length describes text across lifetimes. Chapter hashes may avoid work, but do not independently prove that old absolute coordinates are still correct.

### Concrete composition cases

1. **Go to `LUK 3:1`.** The navigation parser accepts a project name or unique abbreviation and returns a typed partial/complete address. The shell opens the project book, Location resolves against its fresh analysis, and the shell decides chapter clip, caret, flash, and scroll. If verse 1 is absent, Location reports that; the shell may still stop at chapter 3, with the incomplete resolution visible rather than claimed exact.
2. **Link `Luke 3:1–3` in a comment.** The prose matcher recognizes a complete token and validates the range. The target project or bound reference resource is an explicit resolution input. A hover preview can read its resolved passage; click can navigate. Neither parser decides which resource is trusted or whether the link is interactive.
3. **Comment on a selected phrase.** The editor converts the visible selection to canonical source pieces, Location derives the covering verse addresses, and the thread stores exact original pieces, quote/context, and text identity. Accepted Book changes map the current highlight while it is open. A later load re-resolves lazily; a deletion or ambiguous match leaves the original discussion intact and requests reattachment.
4. **Find in reading text.** The reading mask maps a match to one or more source pieces. Location derives a reference from the first piece for the hit label; it must not turn disjoint pieces into one editable enclosing range. Search still owns regex semantics and `resolveHit`'s exact action gate. Excerpts still project a local card and decide how many adjacent verses to show.
5. **STET occurrence.** A guide's frozen reference resolves against the current project book. A bridge may make `JUD 1:2` and `JUD 1:1` land on one physical verse card. The guide's gloss offsets remain in the guide reading; Location never pretends they point into the target wording. STET chooses to skip expected missing project verses while preserving the source reading and provenance.
6. **Finding or inventory site.** The engine has already supplied canonical UTF-16 `from/to`, an engine stamp, and sometimes a fix pointer. Location can attach an address only when the analysis describes that exact text. Navigation may show an offset even without an address. A stale finding is recomputed; the module must not remap a fix or make a corpus underline appear current.
7. **Reference pane or aligned columns.** A source caret/selection becomes an address once, then each named resource resolves independently. One column may be missing or bridged while another succeeds. The pane chooses follow versus pin, `nearest` scrolling, highlight and chapter clip. Block pairing can ask the finer skeleton-address resolver when verse alignment is too coarse.
8. **Window or satellite from a hit.** The source hit's checked span determines the clip or edit scope. Location supplies the semantic place if needed for header/alignment; `Book.apply`, editor admission, `Funnel`, and surface lifetime remain authoritative for changes. A generic location resolver must not confer write capability on a foreign resource.

### Migration by consumer

**First, establish the facts.** Build Location around the Galley adapter's stamped TOC and exercise bridges, front matter, chapter-only positions, duplicate markers, UTF-16 boundaries, and disjoint source pieces. Keep navigation grammar and prose grammar separate while reusing name normalization and address validation. State explicitly when no fresh analysis is available; do not silently scan markers as a different authority.

**Find.** Supply or obtain a matching analysis per scanned source, then replace `buildRefTable`/`refFrom`/`refAt` with Location's inverse lookup. The current search comment calls its marker table provisional. Keep scanning and preview production in Search. A reference-resource hit currently has a resource path and source pieces but no durable source stamp; if those locations are retained or sent to another surface, attach the exact source identity without presenting it as an editable `Book` hit. Do not force a parse per hit: reuse one analysis for the book or batch lookups over its TOC.

**STET and excerpt feeds.** Move `verseAnchor`'s reference join into Location; build `refOccurrences` from resolved results, preserving document order, zero-width target occurrences, and deduplication when bridge references share a physical anchor. The feed continues to own seating, context, lazy projection, expand state, and open-in-editor. `sourceReadings` continues to prefer the frozen guide reading, then a bound source, then no source. Missing target verses remain a STET decision rather than a global resolver filter.

**Findings and inventory.** Replace the two copies of exact-stamp-then-`toc.at` in `navigateTarget` and `siteRef` with one Location query. Preserve `Finding.from/to`, `Finding.id`, engine/source stamps, diagnostics and fixes as produced. The panel's grouping and `asFinding` adapter are separate questions; they need no Location redesign. Keep the current rule that a stale Sous finding disappears until a fresh publication rather than mapping its offsets through edits.

**Navigation and reference panes.** `showReference` should use the same semantic resolver after focus instead of separately searching chapter labels and verse rows. Keep the pending route intent, label-versus-ordinal translation, chapter fallback, and scroll aim in the shell. `ReferencePane` can resolve the source address in its own text for verse pairing and clipping, while retaining its pane-local follow/pin rule and its more precise overlay block matching. A pane's currently registered skeleton ID is a lifetime concern, not the semantic identity of the resource.

**Library.** Keep resource/file discovery and `readBook`. After reading exact text, let the shared resolver replace the regex passage slice in `lookup`; return the same `Option`-shaped public behavior until callers have reason to display distinct missing/ambiguous states. A resource's role and editability remain Library/project policy.

### Open decisions and proof cases

1. **Type boundary:** Is `src/core/location` the single home for the current navigation `Reference` and Book `Ref`, with small `parse`, `address`, `resolve`, and `map` files? Recommended yes, while retaining distinct `Address`, `SourceLocation`, and `LocatedSelection` concepts rather than one object full of optional fields. The exact public names are an implementation decision.
2. **Book-name matching:** Should strict prose accept only full names/slugs, or an abbreviation when it is unique in the supplied catalogue? Recommend allow explicitly registered abbreviations, not arbitrary prefixes; preserve the current forgiving palette behavior as its own grammar.
3. **Incomplete addresses:** Book-only and chapter-only values are needed for navigation, while full verse/range values are needed for links and alignment. Decide whether the parser returns a tagged `Book | Chapter | Verse` address or a parse result whose usable fields are explicit. Do not encode front matter as a valid human chapter `0`.
4. **Missing versus ambiguous:** Confirm whether duplicate structural anchors are a first-class `ambiguous` result or an engine diagnostic plus a deterministic first anchor. Recommend a first-class outcome for any action that would attach, edit, or persist; presentation can still show the diagnostic.
5. **Range extent:** Does resolving `3:1–3` yield whole structural verses, text content only, or both? Recommend exposing both named extents when Kitchen distinguishes them, so a clip and a quotation cannot accidentally choose different meanings for the same unlabelled `from/to`.
6. **Fresh analysis for Search:** Search is synchronous and currently scans raw text with no analysis argument. Decide whether its caller supplies ProjectAnalysis results, whether Search asks a stateless Galley adapter per book when absent, and how partial project readiness appears. Preserve one parse per exact text, not per hit; measure before adding a resident index.
7. **Anchor mapping:** Define insertion affinity at each endpoint, behavior for a replacement that intersects the selected text, and when `mapped`, `re-resolved`, or `needs reattachment` is recorded. This is necessary for comments and persistent locations, but not for ephemeral Find hits or findings.
8. **Resource identity:** A path, bound resource ID, book code, and engine registration ID answer different questions. Specify the stable identity carried by a location and the exact text stamp; avoid treating a pane-scoped registration key as a persistent resource key.
9. **Navigation fallback:** When an exact verse is absent, should a palette jump fall back to chapter while a comment link reports missing? That is caller policy; decide the visible behavior for each first consumer, not in Location.

An initial acceptance table should include `LUK 3:1`, a chapter-only input, a localized book name, `JUD 1:2` inside `\v 1-2`, a missing verse, duplicate `\v` anchors, front matter, a selection ending at the next verse marker, a reading match split by markup, a stale analysis with the same book ID, and a reference resource whose chapter numbering differs from the target. These cases protect a semantic boundary; they are not tests that merely restate a wrapper.

## Direct comparison: ClipWindow versus Satellite

| Concern | `openWindow` (`src/editor/window.ts`) | `mountSatellite` (`src/editor/recipes/satellite.ts`) | Consequence |
| --- | --- | --- | --- |
| Host input | `EditorBook` | Narrow `Funnel` | Window uses `Book.apply`/`attach` directly; satellite uses `Funnel.submit`/`attach`. Both ultimately reach Book, but expose two protocols. |
| Surface | Headless state, optionally bound to a view | Owns an `EditorView` from construction | A shared mount abstraction would have to hide a real lifecycle difference. |
| Scope | Whole book, picked chapter and edit admission | Whole book state, arbitrary moving visual range | A satellite's clipping alone does not guard canonical edits. Its specific recipe/trust decides that. |
| Local submission | `submit` pre-runs local phases; `fromView` sends a view transaction through `book.apply` | Dispatch sends changes to `host.submit` | Window's two entry paths differ from each other; satellite has one dispatch path. Preserve the canonical authority and make refusal behavior explicit before deduplicating. |
| Return | Book publishes `ChangeSet`; window dispatches or updates its held state with `fromCanonical`, `trusted`, no local history, `filter: false` | Funnel publishes `ChangeSet`; satellite dispatches with `fromCanonical`, `trusted`, `filter: false` | Returned-change annotation is shared; window's explicit history annotation reflects its headless/full-editor configuration. |
| Caret | Keeps own selection; accepted view edits restore selection after canonical return | Dispatches selection after offering edit | Check refusal and selection behavior in both; satellite currently dispatches selection even when `submit` returns a refusal. |
| Analysis | Borrows Book structure when exact; may analyze during the one-turn gap | Borrows structure via Funnel when exact; caller provides reading extensions | Sharing a parser cache is not the same as sharing a surface recipe. |
| Lifetime | Calls `book.hold()` and releases it on `close`; may exist with no view | `destroy()` detaches and destroys its view; no hold in `mountSatellite` | ExcerptEditor separately calls `book.hold()`. Note editor mounts inside the canonical view, whose binding keeps the seat attached. A generic helper must not silently change either lifetime. |
| Undo | Headless editor layer and Book history | Keys delegate to `Funnel.undo/redo` | History belongs to Book in both, but exposed controls differ. |

The immediate cleanup candidate is shared documentation and narrowly shared returned-change construction, not a public class. Before changing the protocol, prove these behaviors: rejected edit does not move text or leave a misleading caret; accepted edits publish once; a borrowed surface sees edits made elsewhere; closing a view releases its hold; a window still works headlessly; undo targets Book history. If those checks reveal genuinely identical code, extract only that code.

## Existing boundaries to keep

- **Kitchen:** USFM parse, structural TOC and bridge facts, engine-level offset lookup. No Forgejo/project permissions, manifest-localized book names, CodeMirror facets, or layout.
- **Sefer core/Galley:** exact-text freshness, canonical references, resolved locations, list outcomes, source/projection mapping, excerpt grouping. `src/core` stays free of CodeMirror and DOM imports.
- **Project and Book:** canonical text, seat lifetime, accepted edit publication, one write path.
- **Editor layer:** CodeMirror facets, projection bundle, visible/editable clips, borrowed-surface transaction protocol, decorations.
- **Recipes/UI:** reference panes, excerpt lists, notes, pairing, navigation scroll policy, comments, and aligned layouts.

## Order of work

1. Define the semantic reference and resolved-location contracts with hard examples, including ranges, disjoint lists, bridges, misses, and duplicate anchors. Include both directions: reference → current source span and source offset/selection → typed reference list, with explicit freshness and mapping outcomes.
2. Route one consumer through them; delete its old resolver, then migrate Search, Excerpts/STET, and Library without keeping fallback scanners indefinitely.
3. Consolidate mode extensions. (ResultCard's direct DOM class mutation went with ResultCard, 2026-09-23.)
4. Test window/satellite refusal and lifecycle behavior before extracting any shared mirror internals.
5. Build a reference preview or comment anchor as the next composition test. Only then judge whether an N-column layout needs a reusable container.

In parallel, make the small upstream request for the Galley xxh3 free function and detached-TOC source stamp. Add chapter-level fingerprints to Sefer only if a consumer shows that they answer a useful freshness question.

Each step should remove a competing answer or enable a new consumer. Avoid adding an abstraction that only restates a recipe's options.
