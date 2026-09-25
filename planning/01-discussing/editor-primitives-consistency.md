# Editor primitives and composition consistency

**Status:** working audit, 2026-09-19. Read-only review of the current tree and scripture-kitchen v0.1.4, informed by two independent agent passes. This is a proposed order of consistency work, not implementation authorization. **Updated 2026-09-24** with the vocabulary and decisions from a discussion with Will (next section); where the older text below disagrees, that section wins.

## Aim

New UI recipes—reference tagger, Find/STET excerpts, navigation, comments, paired references, and a future aligned multibuffer—should compose a small set of clear behaviors. They should not each decide how to parse a reference, locate a verse, prove an offset fresh, or attach a surface to canonical text.

The composition to make reliable is:

```text
input → parse reference → resolve against named exact texts → location outcomes
      → excerpt / preview / navigate / aligned panes
      → per-surface projection, clip, marks, follow policy, and write capability
```

`Book` remains the only writable canonical USFM text. A surface's `editable` facet does not make a foreign reference resource writable. Layout is a recipe; ownership and source coordinates are lower-level contracts.

## Vocabulary and decisions, 2026-09-24

These go into the [glossary](../../documentation/glossary.md) when the first of them lands in code. Until then this section is where they live.

### Four words, one job each

"Reference" is not a core term. It is the natural Bible word for "Mat 1:1", but Sefer already spends it on the _reference resource_ (`ReferencePane`, `recipes/reference.ts`), and a word that needs "which reference?" every time is the preview/preview problem again. It stays in product copy for reference texts, and only there.

| Term         | Is                                                                                                                                                                                            | Is not                                                           | Example                               |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------- |
| **Citation** | The characters somebody wrote, in prose or an input box, plus the `Address[]` they mean.                                                                                                      | A place. It is text about a place.                               | "Mat 1:1,3" → two Addresses           |
| **Address**  | A place independent of any translation. No text, no offsets, no hash.                                                                                                                         | A claim that any text contains it.                               | `MAT 1:1–3`                           |
| **Location** | A place in ONE specific text: resource identity, UTF-16 source span or pieces, and the stamp of the exact text those offsets index. May carry the Address it was resolved from or derived to. | Portable. Its offsets mean nothing apart from its text identity. | the project's LUK, 1204–1388, stamp … |
| **Anchor**   | A persisted, versioned claim about a Location: the original Location, quote, context, and an attachment status. Comments only, for now.                                                       | The thread's identity. The thread survives its Anchor failing.   | a passage thread's anchor             |

`Occurrence` leaves this vocabulary: it is a search result, and when it is renamed it becomes **Hit**, the word `resolveHit` already uses. Not blocking.

### Address shape

Every verse Address is a range: a single verse has equal ends, so there is no unranged kind and no `RangedReference`. The range is two points, so a cross-chapter range is not a special case:

```ts
type Point = { readonly chapter: number; readonly verse: number; readonly segment?: string };

type Address =
  | { readonly kind: "book"; readonly book: BookId }
  | { readonly kind: "intro"; readonly book: BookId }
  | { readonly kind: "chapters"; readonly book: BookId; readonly from: number; readonly to: number }
  | { readonly kind: "verses"; readonly book: BookId; readonly from: Point; readonly to: Point };
```

`{ from: Point, to: Point }` over `{ chapter, verseStart, verseEnd, chapterEnd? }`: points compare lexicographically, "is `to` before `from`" is one comparison, and there is no optional field whose absence changes the meaning of the others. The earlier text's "a cross-chapter request can be a list" is withdrawn: `MAT 1:20–2:3` cannot be expanded to a list without knowing how many verses chapter 1 has, which is versification and differs by text. The Address keeps the range; a text answers what it covers when it is resolved.

Cost is not a concern. `LUK 2:2` is two equal points; `LUK 2` is the `chapters` kind with equal ends, and `MAT 2-4` is the same kind with unequal ones (agreed 2026-09-24). A `chapters` Address resolves to the whole of every chapter in it; whether a consumer shows all of it, clips it, or ellipsizes it is that consumer's policy. Resolution always produces a Location with both ends, which is what `editor/recipes/flash.ts` already prefers (a mark when both ends are known, a line only for a caret), and what the scroll aim needs (`from`).

**A bridge is labelled as the bridge.** Displayed to a person, that is "Luke 1:1-2" by default (a copied link's Markdown text, which the author can then edit). Resolving `LUK 1:2` against `\v 1-2` gives the bridge's span, and the Address derived from that span is `LUK 1:1-2`; see U23003 below. Finding the start and the end is a TOC lookup, never arithmetic over verse numbers.

**Front matter is `intro`, never chapter 0.** Output is exact, input may be fuzzy: the parser matches whatever words the catalogue supplies for it ("intro", "introduction", a localized word, and `0` as a developer alias, if wanted), and every one of them produces `{ kind: "intro" }`. A peripheral book with no chapters (`FRT`, `GLO`) is addressed by `book`.

### Citation grammar

The default, English grammar: `;` starts a new chapter group, `,` adds a verse (or range) in the current chapter, `–` or `-` makes a range, `:` separates chapter from verse, and book and chapter carry forward. `Mat 1:1,3; 2:4–6; Mrk 3:1` is four Addresses. Keep the list as written; do not merge `1:1,2` into `1:1–2`. A consumer can coalesce; it cannot un-merge. When a bridge makes two Addresses land on one span, deduplication is the consumer's (STET already does it).

Separators are a convention, not a law: continental usage writes `Mt 1,1.3` for 1:1 and 1:3. The grammar takes its separators as a parameter with the English set as default; making it configurable per project is later. The navigation grammar keeps today's loose reading (`,` and `.` both separate chapter from verse), because it only ever reads one Address from a whole input and cannot be confused by a list.

### Names, held books, and the two kinds of failure

Grammar and names are separate stages, and the name catalogue is passed in, never global.

- The **grammar** splits on delimiters and knows no books.
- The **name catalogue** says which words mean which book (English canon, the project's localized names, registered abbreviations) and which words mean `intro`. For prose, it is an input to the matcher, not a filter afterwards: without the names there is no way to find where a Citation starts ("1 John 2:3" has a digit inside the name; "see chapter 3:16" is not a Citation).
- **Held books** — which books this project has — is a separate set. Today's `ReferenceLookup.known` combines it with the names.

The split exists because it gives two distinct messages:

- **Invalid:** not a Citation. Unknown book word, verse 0, `to` before `from`. Prose: no link. Navigation: "no book called …".
- **Valid but missing:** a real Address the text lacks. A known book the project does not hold; a chapter or verse absent from this text. Prose: a link that says it cannot go there. Navigation: the shell's fallback policy.

Parsing can only report the first; the second is always a resolution outcome.

**No state in core.** Parser and resolver are pure functions of their arguments, and the catalogue is an immutable value. The application builds it: one memo over the project and `ProjectMetadata` (today `lookupFor(project, metadataOf(project))` in `src/app/ui/workspace/books.ts`, which the palette and sidebar each call inside their reactive computation). Callers read the memo when they call, never capture it at setup, which is what avoids a stale closure; the memo is what avoids rebuilding per keystroke. A result is consistent with the one catalogue it was computed against.

### Text identity: Source stamp in session, Fingerprint when persisted

Galley 0.1.5 exports `xxh3(bytes)` and `xxh3Text(text)`: XXH3-64, seed 0, returning a `bigint`, with `xxh3Text(text) === parse(text, …).sourceHash`. Synchronous wasm, so no async colouring (SubtleCrypto's cost); fast (MD5 is not); non-cryptographic, which is correct for "is this the exact text", where nobody is an adversary. This closes the upstream ask below.

- **In session**, a Location carries the Source stamp (Revision + length). No hash is needed.
- **When persisted** (a comment Anchor, a Review-change thread's two compared texts, a copied link), it carries a **Fingerprint**: `{ alg: "xxh3-64", hash: <16 lowercase hex>, length }` over the **Source** — LF-normalized UTF-8, no BOM — never over Disk bytes, so a change of line endings on disk does not detach a comment. The algorithm travels with the value so that changing it later is a migration, not silent breakage.
- `xxh3` over bytes is for the network and storage (a fetched file, a sync comparison); `xxh3Text` over Source is text identity. Name the two at the Sefer adapter so nobody stores one where the other belongs.
- A Fingerprint mismatch means "re-resolve", not "lost". The quote is short enough to store as itself and needs no hash. Chapter fingerprints wait for a consumer that shows they answer a question.

### Non-verse content: footnotes, headings, introductions

The text is USFM, so a Location is a UTF-16 span and a footnote or heading is just a span; it needs no special coordinate system and no boolean. What non-verse content lacks is an _Address_: `MAT 1:14` names a verse, not "the section heading before 1:14" or "the first footnote in 2:1". Two answers, neither needed for the first pass:

- **Derive, do not store.** A Location already knows what it covers; `at`/`covering` can report that a span lies in a note, heading or intro as a fact about the Location (a `part` on the derived answer), found from the engine's structure. That covers "flash the footnote", "copy a link to this footnote", and labelling.
- **Structural block address when a stored target must survive edits.** The engine's `(sid, where, ordinal)` block address, already used by pairing and overlay, is the finer place for non-verse content. An Address `part` qualifier (`note`, `heading`, ordinal) can be added when a consumer needs to _type_ one; until then no parser grammar for footnotes.

A "copy link to highlight" needs no invented `(human)[checksum]` syntax: a Markdown link already hides its machine half. `[Mat 1:14](sefer:MAT/1:14?at=1204-1250&fp=xxh3:…&len=…)` renders as "Mat 1:14"; activation tries the exact span if the Fingerprint matches, and otherwise falls back to the Address. A Citation typed in prose carries no Fingerprint and always resolves by Address.

### U23003, and the scripture-analysis-api that uses it

**Source.** U23003 "USFM References" is a USFM Technical Committee proposal by M. Hosken; the number is its place in the committee's registry. The canonical text is a Google Doc linked from the committee's roadmap ([`usfm-bible/tcdocs`, `docs/USFMTC Roadmap.md`](https://github.com/usfm-bible/tcdocs/blob/main/docs/USFMTC%20Roadmap.md)); a readable Markdown copy is [`paranext/marble-tools`, `docs/u23003.md`](https://github.com/paranext/marble-tools/blob/main/docs/u23003.md). Its sequel, [U25002 Anchors](https://github.com/usfm-bible/tcdocs/blob/main/proposals/2025/U25002%20Anchors.md), is marked approved for USFM 3.2. Scripture Burrito's alignment flavor already names `u23003` as a reference type. Read 2026-09-24.

**What it says, in the parts that touch this plan:**

- **Grammar.** `Reflist = RefRange (Refsep RefRange)*`, `Refsep = ';' | ','`, `chaptersep = ':' | '.'`, verses may carry a subverse letter `a`–`z` or the keyword `end`. `JHN 3` means `JHN 3:1-end`; `GEN 5-23` is a chapter range. Abbreviated references refine the parent of the one before ("contextual references"): in `GEN 1:5-23` the 23 is a verse; in `GEN 5-23` it is a chapter. This is the same carry-forward our Citation grammar describes. One difference: U23003 treats `,` and `;` alike and lets context decide, where the English prose convention reads `;` as "new chapter group".
- **Single-chapter books.** `JUD 1-4` means `JUD 1:1-4`; the grammar cannot know that, the processor does.
- **Bridges.** A reference is intersected with the text's verse units: against `\v 35-36`, `JHN 11:36` expands to `JHN 11:35-36`, and `JHN 11:34-35` to `JHN 11:34-36`. Verse lists in a marker (`\v 1,3,5`) expand the same way.
- **Before verse 1 and before chapter 1.** Verse `0` is pre-verse material inside a chapter (the chapter number is `MRK 1:0`); chapter `0` is the book introduction, refined by marker (`MRK 0!ip!53`, `MRK 0!ip!w!1`).
- **Words and characters.** A "word" is a run of non-space characters, a marker delimits a word, spaces are roughly `\p{Zs}` plus U+200B. It is **not** UAX #29. Characters are counted in **NFD** within a word, and the proposal itself says character references "are not designed for human consumption or entry".
- **Non-scripture text.** `!f` (first footnote in the range), `!f[3]`, `!s1` (a heading, associated with the verse that FOLLOWS it: `1:14!s1!3`), attributes (`!caller`, `!number`). U25002 adds namespaces for elements with no C:V place: `JHN a.authorship` (an `@aid` attribute on a paragraph, note, figure, table or sidebar), `GLO k.LotW` (a glossary `\k`), `t.` for table cells, `p` for peripherals.
- **Resilience to editing.** Its own "Outstanding issues": word, character and marker indexes break under edits; including the word text in the reference was studied (75% of verses contain a repeated word) and rejected. Falling back to the verse is the stated best case.

**Where Sefer lands:**

- **Offsets stay the coordinate system.** A U23003 word or character index is a second coordinate system (whitespace words, NFD characters) that must be recomputed against the text before anything can be drawn, and the proposal concedes it does not survive edits. UTF-16 offsets plus a Fingerprint are exact, draw directly, and are what USFM mode and regular mode already use everywhere. Nothing from the `!` layer is pulled now.
- **Address is the U23003 basic reference.** Book, chapter, verse, ranges and lists are the same model, so an Address's machine spelling should be U23003's (`MAT 1:1-3`, `MAT 2-4`, `JUD 1:4`) rather than a Sefer invention. `intro` serializes as U23003 chapter `0`; the type still carries `kind: "intro"`, so nobody writes `chapter === 0` in Sefer code. Chapter ranges (`MAT 2-4`) are the `chapters` kind. U23003's `end` (`MAT 2:5-end`) is still open (see Before implementation). Subverse letters are a question for when a text that uses them arrives.
- **Bridges render as the bridge.** The derived Address of a bridged span is its whole unit: a caret in `\v 1-2` reports `LUK 1:1-2`, and a Citation `LUK 1:2` resolves to the `\v 1-2` span and is labelled `LUK 1:1-2`, which is U23003's intersection rule. No integer arithmetic: the resolver finds the verse unit that contains the `from` label and the one that contains the `to` label, and the Location runs from the start of the first to the end of the last. The TOC rows already carry bridge bounds.
- **Non-verse targets, when a consumer needs one to survive edits:** U25002's `@aid` is the durable answer for USFM 3.2 texts, and U23003's `!f` / `!s1` letters are the naming to reuse for a `part` qualifier. Neither is needed while offsets plus a Fingerprint carry an in-app link.
- **scripture-analysis-api** ([repo](https://github.com/WycliffeAssociates/scripture-analysis-api), read at `60265e3`) stores its items as U23003 strings with an `anchor_level` (`repo | book | chapter | verse | word | character | non_verse`) against a commit SHA. Consuming its items is an adapter at the edge: parse the basic part into an Address, resolve it, and treat a `!` refinement as a request to segment that verse's text by U23003's rule. Not now.

### Mapping an Anchor through edits

Needed for comments, not for the first pass. The mechanism is outlined in the [commenting idea](../00-ideas/commenting-and-discussion.md#mapping-an-anchor-through-edits); it belongs with Location's `map` piece when it is built.

### Three directions, one answer each

This table is meant to graduate into the architecture documentation when Location lands (Will, 2026-09-24).

Every place question goes through the same pieces, in one of three directions. None of them keeps its own copy of the answer.

| Question                                                            | Who answers                                                                                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| What does `\v 3a` or `\c 12` mean?                                  | **Onion** (`designator::verse`, `designator::chapter`), surfaced through the Galley TOC. Sefer never reads a designator itself. |
| What did this person write?                                         | **Sefer core, Citation parser**: text + name catalogue → `Address[]` or invalid. Pure.                                          |
| Where is this Address in this text? What Address is at this offset? | **Sefer core, Location**: pure functions over one text's stamped TOC. `at`, `covering`, `resolve`.                              |
| Which catalogue, which text, which TOC, how to display it           | **Sefer app, the location service** (below). Policy and wiring, no parsing and no searching of its own.                         |

**The application piece.** One per-project object in the application layer, built where `ProjectContext` builds its other per-project things. It is the ONE place a screen asks "label this offset", "where does this Citation land", or "how do I show this Address", and it holds no state of its own beyond derived values:

- the **name catalogue**, a memo over `ProjectMetadata` and the held books (today's `lookupFor`, built once per metadata change instead of per keystroke);
- **how to reach a text's TOC**: a project Book's through the Corpus (`toc(id)`, no parse needed for a registered book), a reference resource's through Library plus one TOC-only parse per exact text;
- the **display rule**: the project's own book name when the catalogue has one, English otherwise ("Lucas 1:1-2" in a Spanish project). A later preference for native, English or code is possible; not now, to avoid settings sprawl (Will, 2026-09-24).

Not an Effect service and not a Layer: it is synchronous and project-scoped, and the shell rule is that Effect is not a reason to make a service for every noun. Its exact name is chosen when it is written.

### Decided 2026-09-24

- **Scope of the first pass:** the Citation parser (whole input: lists, ranges, chapters, intro) with its test file; Location's `at`, `covering` and `resolve` over the Galley TOC; the application location service; and two consumers moved over, deleting what they replace: navigation (palette and sidebar parse, `showReference`) and Findings/inventory (`navigateTarget`, `siteRef`). Search, Excerpts/STET and Library are the second pass.
- **No prose scanner yet.** Its only consumer is comments. The grammar is built so a scanner can be added later; copy link to highlight waits with it.
- **No verse `end`.** One union member to add when a consumer types one.
- **Displayed names are native first**, English second (above).
- **Tests:** the pure Citation parser gets a table-driven test file; nothing else in Sefer does. Kitchen's tests are welcome (below).
- **The Kitchen change is authorized** as part of this plan, including its commit and `v0.1.7` tag (below).

### Search, for the second pass

Decided 2026-09-24. The Corpus already answers `toc(id)` for every registered book without a parse, so two choices were left:

1. **Reference-resource hits:** pass the text in as a one-off. `handle.parseText(text, false, true, true)` is Galley's door for "text the host holds and has not registered" (TOC, no diagnostics, UTF-16), and its chunk cache keys on content, so Sefer keeps no cache of its own and resources are not registered in the Corpus.
2. **A Book being typed in:** use the last TOC the Corpus published (the stale Solid value) rather than blanking labels and flickering. Wording edits rarely move a verse boundary, and a label is display only; any ACTION on a hit still goes through `resolveHit`'s exact gate. Never a fallback scanner.

### Subverses and verse lists: two grammars, one value

Onion's `designator::verse` follows the spec pattern (`[1-9][0-9]*[\p{L}\p{Mn}]*` then `RLM?[-,][0-9]+[\p{L}\p{Mn}]*` continuations), leniently for non-ASCII segment letters. Today it reads `\v 3a` as verse 3 ("a segment is a label, not a coordinate") and `\v 1,3,5` as 1–5 ("the endpoints; the hole is not modelled"). Only a malformed designator is 0. The Galley TOC keeps those numbers and drops the designator's span ("no token, no designator", `galley/src/toc.md`).

**Decided 2026-09-24 (Will): both should be modelled.**

- **A segment is a coordinate.** `3a` and `3b` are different places; `MAT 1:3` covers both; `MAT 1:3a` resolves to `\v 3a`'s span alone. A `Point` becomes `{ chapter, verse, segment? }`, compared by verse then by segment in source order (U23003 proposes `a`–`z` only, and no segment at either end of a bridge).
- **A verse list has holes.** `\v 1,3,5` covers 1, 3 and 5; `MAT 1:2` is not inside it.

**Where each grammar lives.** What a person writes and what follows `\v` are different questions that share one sub-rule:

- **After `\v`: Onion.** What a USFM designator covers is a fact about a USFM text, and modelling the holes and segments is a correctness change to `Designator` plus the TOC rows that carry it. That is the Kitchen ask (item 5 in the [asks](../00-ideas/scripture-kitchen-asks.md)).
- **What a person wrote: Sefer core.** A Citation is a wider grammar (`;`, chapter ranges, cross-chapter ranges, book names from a localized catalogue) that no USFM designator allows, and localized names are outside Kitchen's boundary. The earlier suggestion to call Onion's designator reader for a Citation's verse token is withdrawn: same-looking tokens, different question.
- **Mise: not yet.** Mise holds standard-derived tables and borrow-free types shared by MORE THAN ONE Kitchen crate, and no policy or engine logic. A verse-token type (`{ verse, segment? }`) and its reader become a Mise candidate the day a second Kitchen crate needs them, for instance a code-form U23003 reader beside Onion. Today only Onion reads one.

The shared thing is the **value**, not the parser: both grammars yield `{ verse, segment? }` points and explicit member lists, so a Citation's `1:3a` and a text's `\v 3a` compare equal without either parser knowing the other. The Citation parser's tests pin the verse-token rule against the spec pattern.

**Until the ask lands,** from JS a segment is invisible and a verse list looks like its endpoints. So `MAT 1:3a` resolves to verse 3's span marked coarser than asked (the same visible, incomplete outcome as a chapter fallback), and a hit inside `\v 1,3,5` is labelled by its endpoints. Neither is presented as exact.

**Landed (v0.1.7, 2026-09-25):** `tocViewOf` reads members and segments, and `resolve` uses them: `MAT 1:3a` finds `\v 3a` exactly (coarser only where the text has plain `\v 3`), `MAT 1:3` over `\v 3a` … `\v 3b` finds both, and `MAT 1:2` is missing from `\v 1,3,5`. A caret in a list is still labelled by its hull (`1-5`): an Address is one range, and the hull leaves out none of what the caret is in.

### Chapter number versus position

The TOC's `chapter` on a verse row is the row's POSITION; `number` on a chapter row is the designator. An Address means the designator, so the resolver goes through chapter rows by `number`, never by index. Recorded so nobody takes the shortcut.

### The coordinated Kitchen change (authorized 2026-09-24)

This plan is the spec for a change across both repositories. Will authorized the Kitchen half explicitly, including committing it and pushing its release tag: "yes I'm saying that explicitly here as a coordinated change."

**Why Kitchen, and why now.** Two facts Sefer needs are Onion's, not Sefer's, and Sefer must not read designators itself to get them (the one-reader rule in `onion/src/designator.rs`):

- `\\v 3a` is its own place (a segment is a coordinate), and `\\v 1,3,5` has holes. Onion today reads the first as 3 and the second as 1–5.
- The TOC drops the designator, so from JS a bridge or segment cannot be labelled as written.

A third change rides along because it touches the same doors: every engine door that takes positional booleans or trailing optional parameters (`parse(text, diagnostics, toc, utf16)`, `parseText`, `toc(id, utf16?)`, `tocAll`, `skeleton`, `sourceNodeFor`, `targetNodeFor`, `updateReference(…, keep_text?)`) takes a typed options object instead, following `setExtensions(list, { relaxZPrefix })`. Will: "I'd generally just prefer killing the positional booleans, and even the trailing optional." The typed object keeps what the positional form was protecting (a misspelled key is a compile error, never a silent `false`). Breaking is acceptable: Kitchen is 0.1.x and Sefer is its only consumer.

**Scope, in Kitchen:**

1. Options objects on every such door, on BOTH the Galley wasm build and onion-wasm (Galley is the superset and the only build Sefer installs), with typed `.d.ts`, the conformance name list, `wasm.md` and the readers updated.
2. `Designator` models its members in written order (points and ranges of `{ number, segment }`), keeping the first/last hull for the consumers that want it (format bridging, lint renumber).
3. The ordering lint reads members: the U23003 example `\\v 1,3,5 … \\v 2 … \\v 4` is clean, and a number already covered is a duplicate. Verdicts on every designator without a list comma stay byte-for-byte unchanged, and unfilled holes are not newly flagged.
4. Both TOC wires (Onion's dish and Galley's census) carry each row's designator label as a SPAN into the source, not a string table (the caller holds the text; `Space::Offset` converts to UTF-16 like every other offset), and each verse row's members as a `Repeat` run. Chapter rows still tile `0..len` (the lossless invariant) and row 0 is still front matter. Format versions bump so an old reader fails at `open`.
5. Tests: behavioural, not implementation detail. Kitchen is a pure library, so Sefer's no-tests rule does not apply there (Will, 2026-09-24).
6. Gate: `cargo nextest run`, `cargo clippy --all-targets`, the wasm wall and conformance run; then commit, tag `v0.1.7`, push.

**Sequence.** Kitchen and Sefer's first pass run in parallel. Sefer's first pass builds on v0.1.6, where a segment resolves as its whole verse (marked coarser than asked) and a verse list as its endpoints. After v0.1.7 is tagged, Sefer bumps the pin, moves every door call to the options objects, and reads labels and members from the TOC. The same items are [Kitchen ask 5](../00-ideas/scripture-kitchen-asks.md).

### Next: a satellite's range is an edit guard (found 2026-09-24)

**The bug, driven in the fixture:** Find "love" → Edit on Philemon 1:5 → select all → Backspace deleted the whole book's text (2,679 → 158 characters; only the markers the Book's rules protect survived). A satellite's scope HIDES the rest of the book (`clippedToScope`) but guards nothing: its document is the whole book, and nothing refuses a change or clamps a selection outside its range. One undo restores it and nothing reaches disk until a version is recorded, but the backup journal records it. On master, not introduced by this work.

**The note editor is the same hole, worse,** and is wrong by design (Will, 2026-09-24): it mounts TRUSTED, so its edits skip the Book's rules entirely. It should not be trusted. It should work exactly like the main editor — the same phases, a clip, edits outside refused as untrusted, accepted edits propagating back to the canonical Book — with only the clip differing, because its purpose differs: the clip is the note. Trust was a workaround: the Book judges a change in the CANONICAL view's projection, where a note body in regular mode is hidden markup, so `refuseKeystrokesInsideHiddenMarkup` refuses every key typed into the note (`noteEditor.ts`'s comment). The design question to settle first is how that rule learns that THIS surface shows the note, instead of trust switching all rules off.

**Scope:**

1. Every satellite's range is an edit guard, installed by `mountSatellite` so no surface can forget it: changes outside refused, the selection clamped, select-all selecting the range. `clip.ts`'s `refuseEditsOutsideTheClip(getRange)` and `pullSelectionsIntoTheClip(getRange)` are already parameterised by the range, so the chapter clip and the satellite range share the two rules rather than growing a second pair. Trust never waives a surface's own range.
2. The note editor untrusted, its clip the note, judged by the same phases as the main editor with the note visible to them.
3. Verified by hand (no tests): select-all delete, a selection extended outside, paste over, typing in a note in regular mode, undo from inside a satellite reaching Book history, and closing an excerpt releasing its hold.
4. `funnel.ts` and `fromCanonical` stop describing windows and result cards (deleted 2026-09-23); the ClipWindow-versus-Satellite table below is history, since there is one borrow protocol now.

**Decided (Will, 2026-09-24): the strong version.** Considered and rejected: only restricting selection, so select-all and cursor movement cannot leave the range. That closes the keys but not every way a change can arrive — a command that edits away from the caret, drag and drop, a paste handler, anything programmatic — so the guard is on the CHANGE (admission refuses what lies outside), and the selection clamp exists only so the caret never sits where typing would be refused. The note editor gets its own plan for its purpose: the same mechanism as the main editor, configured for one note, rather than trust as a shortcut.

**How the note editor gets its plan (2026-09-24).** The spike designed this and Sefer already ported it unused: `src/editor/core/registry.ts` defines a `note-satellite` projection, under which `note.caller` and `note.body` are (point, direct) — visible and editable — where the canonical projection has them at (none, trusted-only), frozen. The spike's `PROPERTIES.md` Table 1 reserves the cell for exactly this ("satellite-editable spans in the satellite projection"), and its probe's "pip #s" toggle is the same mechanism at its smallest: one class's cell (`slot.v` → paint none) changed, and the registry answers with a pip. The plan is policy as data; no rule branches on a mode name.

So the note editor installs `note-satellite`, its clip is the note, and it is untrusted. The one design point is WHERE the edit is judged. Today `Funnel.submit` runs the Book's phases on the canonical state, whose projection freezes the note — which is why trust was reached for. Recommended: the submitting surface's projection and range travel with the edit, and the Book runs the same phases under them (one judge, the same rules, nothing trusted). Rejected: judging in the satellite and handing the Book a trusted result — the same shortcut in another place. To check before building: how the phases read the assignment (`rowAt(state, cls)` off the state's facet), and so what carrying a per-edit projection into them costs.

After this the range rules are three, each named: the chapter clip (visible and editable differ), the satellite range (visible and guarded alike), and an excerpt's snap to whole lines (its own presentation choice). Then the diff UI on the playground builds on both halves of this plan.

**Real-text sweep, same day:** Location over 227 books (Kitchen's test tier and en_ult), 3,843 chapters, 101,907 verses: every verse's Address at its marker resolves back to it, every spelling round-trips, no chapter mismatches. The corpora hold 3 bridges, no verse lists and no segments, 2 malformed designators (`ZEC 12:7"`, a bare `\v` in ACT 8) and one genuine duplicate (bdf_reg ROM 3:10, two drafts left in), which Location reports as ambiguous. About 70 µs a query.

### Not blocking the first pass

The first pass (order of work 1–2: the contracts, then one consumer) needs none of these: the Fingerprint (nothing persists yet), Anchor mapping, the non-verse `part` qualifier, configurable separators, U23003 interop, the Hit rename, and the content extent.

## Ownership list, in priority order

### 1. Canonical reference and location values — Sefer core

Treat `src/core/location` as the proposed cohesive boundary, with small internal pieces rather than one service that owns UI behavior. It should compose (1) parsing text into a semantic address under an explicit input grammar, (2) validating its shape and optionally matching a book name against a supplied name catalogue, (3) locating an offset/selection in stamped source text, (4) resolving an address in one named, stamped resource, and (5) mapping or re-resolving a historical location. These operations should share types and outcomes but remain independently callable. A caller that already has a typed reference should not parse a string, and a window with a known source range should not need a scripture reference at all.

The module returns facts: address, source range or pieces, source identity, and `found`/`missing`/`ambiguous`/`stale` or invalid-input outcomes where applicable. It does not decide whether a surface may open, whether a resource is editable, how far to degrade a scroll target, or whether the result becomes a popup, hyperlink, reference panel, navigation command, or aligned column. Those are caller and editor policies. In particular, projected CodeMirror offsets must be converted to canonical source coordinates at the editor boundary before Location sees them; a discontinuous projection stays in pieces. Book/resource identity and coordinate space must travel with any reusable resolved span.

`src/core/reference/reference.ts`'s `Reference { bookId, chapter?, verse? }` and `src/core/book/book.ts`'s `Ref { book, chapter, verse? }` are near-duplicates. Both become the `Address` above: one book, a `from`/`to` pair of positive points with `from <= to`, a single verse having equal ends, and a cross-chapter range expressed directly rather than as a list. Disjoint references are a list of Addresses, including references to different books. An Address names a semantic place and does not assert that any text contains it. Book-only, intro and chapter-only navigation are Address kinds, not forced verse references.

The navigation parser can remain forgiving and accept a unique abbreviation or a chapter alone. A prose matcher needs a complete recognized book name/slug, chapter and verse or verse range, strict token boundaries, and the matched text span. Both should receive possible book names from the English canon and project metadata, sharing name validation without sharing their acceptance policies. Whether matching uses a generated regex or another index is an implementation choice to measure, not a public primitive.

A resolved reference is a richer value: the semantic reference plus the specific text/resource, UTF-16 source span or disjoint pieces, and text identity. This is the useful superset for a hover preview or clipped view; it does not put a checksum into a reference parsed from prose. A batch resolver should retain `found` or `not found` for every requested reference in every requested text. If malformed data offers duplicate anchors for the same address, report that condition rather than silently choose one. STET can filter misses; an aligned multibuffer cannot silently lose a column.

Resolution normally uses the current analysis. A hyperlink may re-resolve on activation; an edit must verify the exact resolved text before writing. Scroll restoration can degrade from an exact span to verse to chapter when earlier text moved. A whole-book stamp cheaply detects that _something_ changed; an optional chapter/selected-span fingerprint might avoid needless remapping when unrelated text changes, but it cannot make an old absolute offset valid. Re-resolve or map the offset first, then check the destination.

The inverse lookup belongs beside resolution in the same Sefer core module: `referenceAt(analysis, sourceOffset)` returns a typed address, and `referencesCovering(analysis, sourceRange)` returns the addresses covered by a selection. Use half-open source ranges; for a nonempty selection, inspect `to - 1` for its last included character. A selection can cover multiple verses or chapters, so its semantic result may be a list, while the original exact range remains available. Keep the original resolved location immutable and derive a current, optionally mapped location when needed. Mapping accepted edits while the Book is open and lazy re-resolution against a later analysis should share the same freshness and ambiguity outcomes. A deleted or uncertain current location does not erase the original address.

**Why now:** comments, navigation, prose links, Find, and multibuffer alignment all need this answer. A stamp alone is insufficient if the consumer does not also know which resource the offset indexes.

### 2. Structural TOC lookup — Kitchen facts, Sefer adapter

Installed Kitchen already exposes a binary-search `Toc.at(pos)` for source offset → chapter/verse, and chapter/verse rows including bridge bounds. Its public `locate(text, utf16)` returns a formatted label such as `MRK 6:3`; it may clamp an out-of-bounds offset. It is useful for display, but it is not the typed inverse lookup or a substitute for an explicit missing/invalid outcome. Do not parse that label back into a reference or invent another binary search. `src/core/galley` remains Kitchen's sole importer and should publish the narrow Sefer-facing read operations.

**Upstream Kitchen/Galley ask — hash delivered in 0.1.5:** `xxh3(bytes)` and `xxh3Text(text)` (XXH3-64, seed 0, `bigint`, equal to `sourceHash`); see Text identity above. Keep the analysis header's whole-source hash accessible through the Sefer adapter; when a TOC is used apart from its analysis, expose the source hash and length that stamp the text it indexes. A chapter or selected-span hash can then be computed from that exact text slice and the free function. It cannot be derived from the whole-book hash. This hash door should not block the first Sefer resolver, and Sefer should not quietly introduce a competing FNV-like identity. Scripture Burrito's existing MD5 checksum serves a different external format contract.

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

| Current path                                                                            | Question it answers today                                                                          | Location contribution                                                                 | Keep with caller                                                                      |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `core/reference/reference.ts`                                                           | Forgiving typed navigation input → project-held book/chapter/verse; prefixes choose by canon order | Shared name catalogue, grammar-specific parse result, typed address validation        | Palette/sidebar acceptance and navigation                                             |
| `core/search/search.ts` `buildRefTable`/`refAt`/`refFrom`                               | Raw or projected Find hit's first source offset → `Ref` using a private `\c`/`\v` scan             | Stamped offset → structural address from Galley TOC                                   | Regex/reading search, hit preview, replace rules                                      |
| `core/excerpts/excerpts.ts` `verseAnchor`/`refOccurrences`                              | STET/Find reference → verse span; bridge references coalesce into one zero-width target occurrence | Address → source span, including bridge and missing outcomes                          | Card grouping, context expansion, zero-width target marks, omission policy            |
| `core/resources/library.ts` `lookup`                                                    | Resource binding + `Ref` → passage, currently sliced by marker regex                               | Address → location in text after Library reads the book                               | File selection, I/O, resource registration, passage presentation                      |
| `core/findings/findings.ts` `navigateTarget` and `core/findings/inventory.ts` `siteRef` | Exact diagnostic/site offset → optional `Ref`, only after engine stamp matches                     | One exactness check and one offset → address lookup                                   | Finding identity, severity, panel ordering, fixes                                     |
| `app/ProjectContext.tsx` `showReference`                                                | Parsed book/chapter/verse → open book, find chapter label, then verse row and scroll               | Resolve address against the newly focused text and report how far it resolves         | Routing, pending intent, clip preference, scroll and fallback policy                  |
| `editor/recipes/whereAmI.ts`, `LocationBar`, `ReferencePane`                            | Visible/caret chapter and corresponding place in a bound book                                      | Translate a source position to semantic chapter/verse; resolve it in another resource | Viewport measurement, follow/pin, clip, highlight and scroll                          |
| `editor/recipes/pairing.ts`, `core/galley/overlay.ts`                                   | Pair a verse or a more precise `(sid, where, ordinal)` block across texts                          | Reuse verse address resolution where appropriate                                      | Block correspondence and paint; a block address is not reducible to a verse reference |
| `core/search/search.ts` `resolveHit`, `core/findings/finding.ts` `stale`, `core/fixes`  | Is a stored offset still safe for this action?                                                     | Shared source-identity vocabulary and exactness predicate                             | Search hit retention, publication lifecycle, fix admission                            |

This inventory does **not** call every range a Location. `Occurrence` is a hit at exact characters; `Finding` is an engine-produced diagnostic; an `Excerpt` is a lazy display model; a window or satellite is an editor lifetime and transaction protocol. Location should serve them without absorbing their state or replacing their established authority. Existing project analysis already publishes current findings; mapping a comment anchor through edits is not a license to shift a Sous diagnostic instead of recomputing it.

### A small public contract to test before choosing files

The module name is a useful organizing proposal, not a mandate for one class or a stateful service. Its pure pieces might look like this; names and exact TypeScript shapes are provisional:

```ts
parseNavigation(input, names); // permissive, may yield book/chapter only
matchProse(input, names); // strict, returns matched text span(s)
validateAddress(candidate); // positive, ordered, one-chapter verse range
at(analysis, sourceOffset); // typed address or front/chapter-only/missing
covering(analysis, sourcePieces); // ordered addresses, without filling gaps
resolve(analysis, address); // source span(s) | missing | ambiguous
describeExactly(analysis, source); // same source text, no coordinate guessing
```

`Address` means a place independent of a particular translation. An exact `Location` should name its resource/book, coordinate space, span or pieces, and source identity; it may also carry a derived address. A persisted Anchor can contain an immutable original `Location` plus an optional derived current location and attachment status. Do not make one mutable “superset Reference” whose checksum and offsets silently change while its apparent identity stays constant. The current `Ref` with chapter `0` usefully labels front matter; it should be an explicit located state, not pass the positive-number validation for a human verse reference.

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

1. **Type boundary:** Is `src/core/location` the single home for the current navigation `Reference` and Book `Ref`, with small `parse`, `address`, `resolve`, and `map` files? Recommended yes, while retaining distinct `Address`, `SourceLocation`, and `LocatedSelection` concepts rather than one object full of optional fields. The exact public names are an implementation decision. **2026-09-24: yes; the concepts are Citation, Address, Location, Anchor (see Vocabulary).**
2. **Book-name matching:** Should strict prose accept only full names/slugs, or an abbreviation when it is unique in the supplied catalogue? Recommend allow explicitly registered abbreviations, not arbitrary prefixes; preserve the current forgiving palette behavior as its own grammar. **2026-09-24: agreed.**
3. **Incomplete addresses:** Book-only and chapter-only values are needed for navigation, while full verse/range values are needed for links and alignment. Decide whether the parser returns a tagged `Book | Chapter | Verse` address or a parse result whose usable fields are explicit. Do not encode front matter as a valid human chapter `0`. **2026-09-24: tagged union `book | intro | chapters | verses`; front matter is `intro`, whatever word was typed.**
4. **Missing versus ambiguous:** Confirm whether duplicate structural anchors are a first-class `ambiguous` result or an engine diagnostic plus a deterministic first anchor. Recommend a first-class outcome for any action that would attach, edit, or persist; presentation can still show the diagnostic. **2026-09-24: agreed, first-class.**
5. **Range extent:** Does resolving `3:1–3` yield whole structural verses, text content only, or both? Recommend exposing both named extents when Kitchen distinguishes them, so a clip and a quotation cannot accidentally choose different meanings for the same unlabelled `from/to`. **2026-09-24 lean: ship one NAMED extent (structural: marker to the next verse or chapter marker) and add a content extent when the first quotation or preview needs it.**
6. **Fresh analysis for Search:** Search is synchronous and currently scans raw text with no analysis argument. Decide whether its caller supplies ProjectAnalysis results, whether Search asks a stateless Galley adapter per book when absent, and how partial project readiness appears. Preserve one parse per exact text, not per hit; measure before adding a resident index. **2026-09-24 lean: the caller supplies ProjectAnalysis; Search stays synchronous and pure; a book with no fresh analysis gets hits without an address label, and no fallback scanner.**
7. **Anchor mapping:** Define insertion affinity at each endpoint, behavior for a replacement that intersects the selected text, and when `mapped`, `re-resolved`, or `needs reattachment` is recorded. This is necessary for comments and persistent locations, but not for ephemeral Find hits or findings. **2026-09-24: proposed in Mapping an Anchor through edits (exclusive affinity, three tiers). Not part of the first pass.**
8. **Resource identity:** A path, bound resource ID, book code, and engine registration ID answer different questions. Specify the stable identity carried by a location and the exact text stamp; avoid treating a pane-scoped registration key as a persistent resource key. **2026-09-24 lean: project or resource binding + book code, plus a Source stamp in session or a Fingerprint when persisted. Never a path or an engine registration key.**
9. **Navigation fallback:** When an exact verse is absent, should a palette jump fall back to chapter while a comment link reports missing? That is caller policy; decide the visible behavior for each first consumer, not in Location. **2026-09-24: agreed. Palette falls back to the chapter and says so; a link reports missing.**

An initial acceptance table should include `LUK 3:1`, a chapter-only input, a localized book name, `JUD 1:2` inside `\v 1-2`, a missing verse, duplicate `\v` anchors, front matter, a selection ending at the next verse marker, a reading match split by markup, a stale analysis with the same book ID, and a reference resource whose chapter numbering differs from the target. These cases protect a semantic boundary; they are not tests that merely restate a wrapper. **Testing, per Will 2026-09-24:** the pure parser (Citation grammar, name catalogue matching, Address validation) is the ONE exception to the no-tests rule and gets a table-driven test file, because most of the application stands on it. Everything else in this plan, resolution against a text included, is checked by hand in the running app until behaviour is locked.

## Direct comparison: ClipWindow versus Satellite

| Concern          | `openWindow` (`src/editor/window.ts`)                                                                                                      | `mountSatellite` (`src/editor/recipes/satellite.ts`)                                                | Consequence                                                                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host input       | `EditorBook`                                                                                                                               | Narrow `Funnel`                                                                                     | Window uses `Book.apply`/`attach` directly; satellite uses `Funnel.submit`/`attach`. Both ultimately reach Book, but expose two protocols.                                                    |
| Surface          | Headless state, optionally bound to a view                                                                                                 | Owns an `EditorView` from construction                                                              | A shared mount abstraction would have to hide a real lifecycle difference.                                                                                                                    |
| Scope            | Whole book, picked chapter and edit admission                                                                                              | Whole book state, arbitrary moving visual range                                                     | A satellite's clipping alone does not guard canonical edits. Its specific recipe/trust decides that.                                                                                          |
| Local submission | `submit` pre-runs local phases; `fromView` sends a view transaction through `book.apply`                                                   | Dispatch sends changes to `host.submit`                                                             | Window's two entry paths differ from each other; satellite has one dispatch path. Preserve the canonical authority and make refusal behavior explicit before deduplicating.                   |
| Return           | Book publishes `ChangeSet`; window dispatches or updates its held state with `fromCanonical`, `trusted`, no local history, `filter: false` | Funnel publishes `ChangeSet`; satellite dispatches with `fromCanonical`, `trusted`, `filter: false` | Returned-change annotation is shared; window's explicit history annotation reflects its headless/full-editor configuration.                                                                   |
| Caret            | Keeps own selection; accepted view edits restore selection after canonical return                                                          | Dispatches selection after offering edit                                                            | Check refusal and selection behavior in both; satellite currently dispatches selection even when `submit` returns a refusal.                                                                  |
| Analysis         | Borrows Book structure when exact; may analyze during the one-turn gap                                                                     | Borrows structure via Funnel when exact; caller provides reading extensions                         | Sharing a parser cache is not the same as sharing a surface recipe.                                                                                                                           |
| Lifetime         | Calls `book.hold()` and releases it on `close`; may exist with no view                                                                     | `destroy()` detaches and destroys its view; no hold in `mountSatellite`                             | ExcerptEditor separately calls `book.hold()`. Note editor mounts inside the canonical view, whose binding keeps the seat attached. A generic helper must not silently change either lifetime. |
| Undo             | Headless editor layer and Book history                                                                                                     | Keys delegate to `Funnel.undo/redo`                                                                 | History belongs to Book in both, but exposed controls differ.                                                                                                                                 |

The immediate cleanup candidate is shared documentation and narrowly shared returned-change construction, not a public class. Before changing the protocol, check these behaviors by hand: rejected edit does not move text or leave a misleading caret; accepted edits publish once; a borrowed surface sees edits made elsewhere; closing a view releases its hold; a window still works headlessly; undo targets Book history. If those checks reveal genuinely identical code, extract only that code.

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
4. Verify window/satellite refusal and lifecycle behavior by hand before extracting any shared mirror internals. No tests until the behaviour is locked.
5. Build a reference preview or comment anchor as the next composition test. Only then judge whether an N-column layout needs a reusable container.

The Galley xxh3 free function arrived in 0.1.5. Still to confirm: whether a TOC used apart from its analysis exposes the source hash and length it indexes; if not, that is the remaining small upstream ask. Add chapter-level fingerprints to Sefer only if a consumer shows that they answer a useful freshness question.

Each step should remove a competing answer or enable a new consumer. Avoid adding an abstraction that only restates a recipe's options.
