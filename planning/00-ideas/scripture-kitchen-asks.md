# Engine asks: what Sefer still needs from Onion, Sous and Galley

Trimmed 2026-09-23 to the asks that are still open. Everything else here was delivered (v0.1.0 to v0.1.3) or became moot when the native corpus was deleted; the full history is in git (`git log -- planning/01-discussing/engine-asks-2026-09-14.md`).

Sefer uses the located diff runs (item 8) and the reader-text mask (item 10). `Tree.spansIn`/`Tree.enclosing` (item 9) are available and unused until something needs a markup extent; see [services](../../documentation/services.md#galley).

## 2. Sous — a real character census, not only convictions

**Asked:** a character-by-character inventory page (occurrences, spread, neighbours, placement, clusters) with "show the other places this character appears".

**State:** the Sous publication's pattern table holds a row only when a channel has a claim to make. On `fixtures/small-nt` that is 11 rows over 10 glyphs, all convicted, and zero word patterns. `/inventory` therefore labels itself "the characters the engine measured". Will: "current sous doesn't have the full detail; I'll change there."

**Change, per glyph in the corpus (convicted or not):**

- total sites and per-book spread
- the full neighbour table on both sides (exact and pooled)
- placement against Letter / Space / Digit / Nonletter / Edge
- run (cluster) shapes
- **an API that enumerates every site of a glyph or of a pattern**, not only the convicted ones

Rarity's denominator today is the corpus total, so `Glyph.sites` has to take Rarity's numerator and the other channels' denominator. A per-glyph total would remove that special case.

**Sefer side ready:**

- `src/core/findings/inventory.ts`, `Finding.pattern`, `/inventory` ([inventory](../../documentation/architecture/inventory.md))
- `sitesOfGlyph` is parked (`planning/04-parked/parked.md`) until a caller wants it

## 4. Chapter labels — Onion's job

**Asked (the old app had it):** a chapter-label picker that rewrites `\cl` / `\cp`.

**Decision:** Will: "will be an Onion thing." Deferred. No Sefer UI is planned until the engine defines the operation, most likely as edits, the way format works.

## 5. Designators model segments and list holes, and the TOC carries both

**Delivered in v0.1.7 (2026-09-25)**; Sefer reads it (`tocViewOf`, `resolve`; see `documentation/architecture/location.md`). Kept below for the record until the next trim.

**Asked 2026-09-24**, from the editor primitives plan (retired; in git history).

**State:** Onion's `designator::verse` reads `\v 3a` as 3–3 ("a segment is a label, not a coordinate") and `\v 1,3,5` as 1–5 ("the hole is not modelled"). The Galley TOC keeps `first`/`last` and drops the designator span, so from JS a segment cannot be told apart from its verse and a verse list looks like a bridge.

**Will, 2026-09-24:** both should be modelled. A segment is a coordinate (`3a` and `3b` are different places), and a list has holes (`2` is not in `\v 1,3,5`).

**Change:**

- `Designator` carries its members: each `{ number, segment? }` point or range, in written order, not only the endpoints;
- each TOC verse row exposes those members (and its label as written), and each chapter row its label (`\c 12b`);
- lint's duplicate and ordering rules then read members, so `\v 1,3,5` followed by `\v 2` is not an overlap.

**Sefer side:** Location's resolver and the display of bridged Addresses. Until then `3a` resolves as verse 3, marked coarser than asked, and verse lists as their endpoints.

## 6. An empty note has a body part

**Asked 2026-09-25.** A fresh footnote, `\f + \ft \f*`, parses with no body part: nothing lies between `\ft ` and `\f*`, so the plan has no body target there, and the position where the body belongs sits inside one merged run of hidden markup.

**Why it matters:** the note editor is now untrusted and judged by the Book's own phases under the `note-satellite` projection. With no body part, `refuseKeystrokesInsideHiddenMarkup` refuses the first keystroke into an empty note. Sefer carries a narrow carve-out for it (`src/editor/core/sealed.ts`: a pure insertion exactly at a zero-width surface range passes that one rule; every other rule still applies), which is policy standing in for a parse fact.

**Change:** the parse (and the plan built from it) produces an EMPTY body target for a note whose body is empty — a zero-width part at the position after the body marker's space — so an empty body is a place like any other and the carve-out can be deleted. The same likely holds for any character-style body that can be empty (`\fr`, `\xt`), which is worth checking while there.

**Sefer side:** delete the carve-out in `sealed.ts` and verify typing into a fresh footnote by hand.

## 7. An unknown marker leaves its paragraph open

**Asked 2026-09-25.** Sefer treats an unknown marker as passthrough (invisible, immutable, the caret goes around it), like a registered standalone. But the engine closes the paragraph at the end of the line an unknown marker is on, inline or alone on its line: type `\zqq` into a paragraph and every line after it belongs to no paragraph and shows as a separate line. A registered standalone (`\s5` via `setExtensions`) already leaves its paragraph open.

**Change:** an unknown marker does not end its paragraph — the recovery a registered standalone gets, applied to a marker nobody registered. Findings still report it as unknown.

**Sefer side:** nothing to change; the paragraph then flows through it as it does through `\s5`.

## 8. `diff` ships only what changed

**Asked 2026-09-26, rewritten 2026-09-27 after measuring.** The first version of this ask was to skip unchanged chapters inside `diff`. The measurement says alignment is not the cost. Timed in Node against the 0.1.7 web build, on en_ulb with one verse in forty edited:

|                       | Psalms     | All 66 books |
| --------------------- | ---------- | ------------ |
| `diff` with `"words"` | 9.0 ms     | 105 ms       |
| `diff` with `"none"`  | 6.6 ms     | 74 ms        |
| The JSON it returns   | 1,364 KB   | 18,137 KB    |
| `JSON.parse` of it    | 3.5 ms     | 48 ms        |
| Units / units changed | 2,612 / 61 | 32,357 / 743 |

Diffing a book against itself still takes 8.6 ms and returns 992 KB. With identical sides the alignment short-circuits, so that is lexing, the TOC and the serialization. In Psalms the 2,551 unchanged units are 799 KB of the JSON (about 320 bytes each, most of it repeated sids and false flags), and the slots add another 173 KB. Sefer then parses the JSON and walks every unit again (`decodeSkeleton`, one `parseAddr` per side). A whole-book diff is cheap. Shipping every unchanged unit, and decoding it again, is where the time goes.

**Change:** add an option on `diff` (its options object from 0.1.7) that leaves `unchanged` units out of `units`, with slots and `afterUnit` renumbered or anchored so the order is still recoverable. Nothing reads an unchanged unit: a decision is only ever made on a changed one, `merge` re-diffs on its own side, and a view shows the unchanged text from the document itself. Keep the default as it is, so nothing that relies on the full skeleton breaks. A compact binary wire (spans in a `Uint32Array`) would be the next step if the JSON of the changed units ever matters. It doesn't yet.

**Sefer side:** ask for changed-only, and skip calling `diff` at all when both sides have the same `sameSource` stamp (hash and length). That second check is Sefer's alone, and it removes every untouched book from an all-books review.

## 9. `DiagnosticView.message()` leaves `{aux}` in

**Asked 2026-10-01.** `message(slice)` fills `{anchor}` and `{second}` and nothing else, so every template that names its aux reaches the reader raw: "verse 4 skips ahead; expected {aux}", "\q2 mixes numbered and bare spellings with \q (levels 1-{aux})". Twelve catalogue rows carry an aux; `{aux}` appears in the templates of the `expectedNumber`, `numberingCap` and `version` ones.

**Change:** `message()` also replaces `{aux}`: the number itself, and for a `version` aux the `USFM_VERSIONS` entry. Please confirm that a `version` aux IS an index into `USFM_VERSIONS`; Sefer assumes so.

**Sefer side:** `diagnosticMessage` (`src/core/galley/analysis.ts`) fills it today; drop that once kitchen does.

## 10. Every finding code as an exported union, to switch on

**Asked 2026-10-01.** The wording is Sefer's to own (and to translate); kitchen ships no English for it. What Sefer needs is a closed vocabulary to switch on exhaustively. Today none is exported as such: onion's names are reachable only as `(typeof CODES)[number]["name"]`, and a sous finding's code is assembled by Sefer from three tuples (`HygieneClass`, `PresenceKind`, `Channel`) plus two lanes with no enum at all (source copy, length proportionality). Sefer keys `src/app/ui/panels/findingLabels.ts` by those today.

**Change:** export the unions by name — `DiagnosticName` from the onion reader, and one for sous's finding kinds/lanes — so a consumer's `switch (code)` or `satisfies Record<…>` breaks when a code is added or dropped. English rule descriptions for agents may ride along as docs; Sefer still switches on the code for its own strings.

**Sefer side:** key the label tables by the exported unions; nothing else moves.

We can put in a scripture kitchen ask about the potential logic of tiling backward however so that stuff like a \p end up reading as part the one they attach too instead of previous as trailing info:

sssssssssssssssssssssssere -> not trigger an error. Only 3 exactly.
