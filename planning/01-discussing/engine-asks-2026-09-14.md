# Engine asks: what Sefer still needs from Onion, Sous and Galley

Trimmed 2026-09-23 to the asks that are still open. Everything else here was delivered (v0.1.0 to v0.1.3) or became moot when the native corpus was deleted; the full history is in git (`git log -- planning/01-discussing/engine-asks-2026-09-14.md`).

Two things were delivered but are **not adopted in Sefer yet**:
- located diff runs `{from, to, kind, what}` (item 8)
- `spansIn`/`enclosing` (item 9) and the `readerText` mask recipe (item 10)

That adoption is tracked in [services](../../documentation/services.md#galley), not here.

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
