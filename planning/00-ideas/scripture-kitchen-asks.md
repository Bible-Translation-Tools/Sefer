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

**Asked 2026-09-24**, from the [editor primitives plan](../01-discussing/editor-primitives-consistency.md#subverses-and-verse-lists-two-grammars-one-value).

**State:** Onion's `designator::verse` reads `\v 3a` as 3–3 ("a segment is a label, not a coordinate") and `\v 1,3,5` as 1–5 ("the hole is not modelled"). The Galley TOC keeps `first`/`last` and drops the designator span, so from JS a segment cannot be told apart from its verse and a verse list looks like a bridge.

**Will, 2026-09-24:** both should be modelled. A segment is a coordinate (`3a` and `3b` are different places), and a list has holes (`2` is not in `\v 1,3,5`).

**Change:**

- `Designator` carries its members: each `{ number, segment? }` point or range, in written order, not only the endpoints;
- each TOC verse row exposes those members (and its label as written), and each chapter row its label (`\c 12b`);
- lint's duplicate and ordering rules then read members, so `\v 1,3,5` followed by `\v 2` is not an overlap.

**Sefer side:** Location's resolver and the display of bridged Addresses. Until then `3a` resolves as verse 3, marked coarser than asked, and verse lists as their endpoints.
