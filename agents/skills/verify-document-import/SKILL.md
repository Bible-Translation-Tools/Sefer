---
name: verify-document-import
description: Check a change to packages/document-import (the Word/LibreOffice → USFM reader) against its two promises — the translator's text comes out whole and in order, and verse numbers only go up within a chapter — over thousands of generated documents. Use before claiming a change to render.ts, verses.ts, model.ts, docx.ts or odt.ts is safe, or when an import loses, duplicates or reorders text.
---

# Verify document import

`@sefer/document-import` turns a .docx or .odt into USFM. Sefer's rule is that **import never normalises**: it copies the text and its order, and repairs come later as visible fixes. A bug that loses one word of one verse in one document is the kind no one notices until a translation goes out. The fixture tests can't catch it, because they only cover the few shapes someone thought to write. This check generates thousands of documents and settings, runs the real `render`, and checks every result.

## Run it

```sh
pnpm --filter @sefer/document-import verify            # 3,000 cases, under a second
RUNS=50000 pnpm --filter @sefer/document-import verify  # before a release, or after a big change
SEED=13676 RUNS=1 pnpm --filter @sefer/document-import verify   # replay one failure
```

The script is `packages/document-import/src/faithful.verify.ts`, run with `node --test` (Node 23.6 or later; no vitest, no browser). The fixture tests are separate: `pnpm exec vitest run --project core packages/document-import`.

## The properties

1. **Faithful.** Every letter of the document's text comes out in the USFM, in the same order, none lost and none doubled. Footnote bodies count, at the place the reference sits. Chapter labels ("Chapter 3") are the only paragraphs allowed to vanish.
   - _How it is checked:_ words are generated only from letters that nothing in render consumes (no `e r s v`, no digits, no `.` `-` `,`). Both sides are filtered down to those letters and must be equal. Verse numbers, `v`/`verse`, quantities, USFM markers and whitespace all filter out, so the guesses (poetry, headings, front matter, `\it`, `\bd`, renames) can change freely and the property still says something exact.
   - _Harm if broken:_ a word or a footnote silently missing from a translator's import.
2. **Verse order.** Within one `\c`, the `\v` numbers only go up (a bridge `\v 3-4` counts as up to 4), and no `\v` comes before the first `\c`.
   - _Harm if broken:_ a duplicated or backwards verse, which the overlay and the review screens then mis-pair.

## What it covers, and what it does not

- **Covers:** `render` in `src/render.ts` (scan, paragraph markers, emit, tidy, chapter labels, front and heading lines, footnotes, comments) and `src/verses.ts` (candidates, detectMode, nextVerse). It runs every verse mode (`auto`, `superscript`, `marked`, `lineStart`, `perLine`, `any`) against random paragraph roles, indents, alignment, lists, tables, style names, italic and bold, line breaks, footnotes, comments, and number shapes (`12`, `12.`, `3-4`, `1,000`, `1 000`, `v12`, `verse 12`, numbers inside a run such as `and 3 sons`). It also covers optional versification and marker renames.
- **Bounds:** up to 14 paragraphs of up to 14 inlines each; 3,000 cases by default. A pass covers what the generator makes, not every document.
- **Assumes no setting drops anything.** `front: "drop"`, `headings: "drop"` and `notes: "drop"` remove text on purpose, so they are left out of property 1. Property 2 holds for every setting.
- **Not covered:** the XML readers (`docx.ts`, `odt.ts`). They are checked against the real files by the vitest fixture tests in `src/render.test.ts`, which also confirm that Word, Word with raised-baseline numbers, and Writer give byte-identical USFM for Titus. The pasted-USFM passthrough is not covered either; the generator never writes a backslash. Neither is whether a guess is _right_ (is this paragraph really poetry?). That is a judgement for the preview, not a property.

## Reading a failure

The failure prints the seed, the settings, the generated paragraphs as JSON, and the USFM.

- `letters differ at N: wanted "…", got "…"`: the first place the output's letters stop matching. `got` shorter means text was lost; `got` holding a stretch twice means duplication. Find the paragraph that holds the `wanted` letters in the printed reading, and follow it through `scan` (was it taken for a chapter label? was its remainder after a verse number pushed?) and `emit` (did its block kind drop a piece kind?).
- `\v N after verse M in chapter C`: a number was accepted out of sequence. Look at `nextVerse` and at whoever calls `startVerse`.

**A real bug or the generator?** If the letters that differ came from a token the generator meant to be filtered out (a digit, `,` or `.` from a number shape), the generator is at fault: fix `KEPT` or the token, not render. If they are letters from `ALPHABET`, `é` or `ñ`, it is a real bug. Do not weaken a property to make a run pass. Report the seed and the paragraph.

## Keeping it true

When you change what render may do with text, change the property in the same commit. For example, a new setting that drops something joins the "assumes no setting drops anything" list, and the generator stops choosing it. When you add a new kind of inline or paragraph field to `model.ts`, teach the generator to produce it. Otherwise the check passes without ever having seen it.

Every check must be able to fail. After changing the check, break the code it guards, see it fail, then put the code back. These two breaks were confirmed to fail:

- `render.ts`, in `scan`: `push(inline.text.length);` → `if (cursor === 0) push(inline.text.length);` (drops the rest of a run after its last verse number) fails property 1.
- `verses.ts`, in `nextVerse`: `candidate.from > previous &&` → `candidate.from >= previous &&` (accepts a verse twice) fails property 2.

A break that only removes whitespace after a verse number is _not_ caught, and that is correct: whitespace is not text this check promises to keep.

## Record

- Covers: `packages/document-import/src/render.ts` (`render`, `scan`, `paragraphMarker`, `emit`, `tidy`, `chapterLabel`), `packages/document-import/src/verses.ts` (`candidates`, `detectMode`, `nextVerse`, `gapFor`).
- Confirmed against the code at: `f03d30c9`, plus the uncommitted package as of 2026-10-29. Move this forward only after you have rerun the check and confirmed that the properties still describe the code at the new commit.
- Found on its first runs, both since fixed: a footnote in a heading or before verse 1 was dropped (`emit` built front and heading lines from text pieces only); a paragraph that was just a number with a footnote was read as a chapter label and dropped along with its note (`scan`).
