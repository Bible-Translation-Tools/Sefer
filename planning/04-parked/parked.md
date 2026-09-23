# Parked code

Code that was built, then removed because nothing used it, and kept here as a way back. Unlike `00-ideas`, these were real, working pieces of the app. They're parked because no screen wanted them _yet_, not because the idea was rejected.

Every entry names the commit the code can be read from. Recover a file with `git show <commit>:<path>`. Nothing here is compiled, linted or analysed, which is the point: parked code shouldn't keep being typechecked against a codebase that has moved on.

---

## Copy profiles: copy as source / as seen / text only / verses and text

- **was:** `src/editor/recipes/copy.ts` (the whole file)
- **read it at:** `git show c7d68af:src/editor/recipes/copy.ts`
- **parked:** 2026-09-23. Nothing installed it, and no plan asked for it.
- **what it did:** a `copyProfileFacet` choosing one of four profiles, and a `clipboardOutputFilter` (`copyProfile`) that folds the copied range through a per-class emit table (content, slot, chrome, delimiter, boundary, optbreak, atom → omit / verbatim / newline / space).
- **would need:** a place to choose the profile (a setting or a Copy-as command), and `copyProfile` installed in `core/compose.ts`.

## Aligned-word tooltip

- **was:** `alignedWordTooltip` in `src/editor/recipes/attrs.ts` (the file also held `attrSpans`, unused too)
- **read it at:** `git show c7d68af:src/editor/recipes/attrs.ts`
- **parked:** 2026-09-23. It threw `TODO(seam)` and nothing installed it; the 2026-09-13 build-out review had already flagged it.
- **what it did:** a hover tooltip over a `\w` word showing its alignment attributes, with keys locked and values editable.
- **would need:** the seam it was waiting for (editing an attribute value through the book's write path), then installing it in the reading layer.

## "Other places this character is flagged"

- **was:** `sitesOfGlyph(inventory, codePoint)` in `src/core/findings/inventory.ts`
- **read it at:** `git show c7d68af:src/core/findings/inventory.ts`
- **parked:** 2026-09-23. `inventory.md` names it as the door for the editor's lint tooltip or a Findings filter; neither exists.
- **what it did:** `held.glyphs.find((g) => g.codePoint === codePoint)?.flagged ?? []`. One line, but it's the one place the grouping rule lived.
- **would need:** the tooltip or filter that asks.

## Base severity of a finding code, for a legend

- **was:** `severityOf(code)` in `src/core/findings/finding.ts`
- **read it at:** `git show c7d68af:src/core/findings/finding.ts`
- **parked:** 2026-09-23. It was written for a severity legend or filter list that was never built.
- **what it did:** the severity an Onion code carries with no declared `\usfm` version (the catalogue's base rung). Deliberately _not_ a finding's severity, since several codes escalate once a version is declared.
- **would need:** the legend.
