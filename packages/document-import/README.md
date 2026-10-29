# @sefer/document-import

Reads a translation draft written in Word (`.docx`) or LibreOffice (`.odt`) and renders it as USFM. Plain TypeScript with no Sefer imports, so it can move out of this repository unchanged.

```ts
import { readDocument, render } from "@sefer/document-import";

const reading = await readDocument(bytes); // once per file
const { usfm, report, comments } = render(reading, { book: "TIT" }); // rerun on every settings change
```

## What it keeps

The output follows the document as written. Each paragraph stays a paragraph, in order, and the text stays as it was written. A guess about what a paragraph is (poetry, heading, title) is listed in `report.guesses` with its reason, and each kind of guess has a setting that turns it off. It does no merging, reordering or repair. That is the host's job, as visible fixes afterwards.

| In the document                                                                                  | Default                                                       | Setting                                                                                                                                   |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Verse numbers                                                                                    | `\v`, by the convention the document uses (`report.detected`) | `verses`: `auto`, `superscript`, `marked` (`v1`, `verse 1`), `lineStart`, `perLine` (no numbers: each paragraph is the next verse), `any` |
| "Chapter 3", a bare "Chapter", a paragraph holding only the next chapter's number, verse 1 again | `\c`                                                          | `chapterWords` (default `["chapter"]`)                                                                                                    |
| Text before the first verse                                                                      | `\rem`                                                        | `front`: `rem`, `mt`, `drop`                                                                                                              |
| Heading styles; short, bold or centred lines with no verse                                       | `\s1`                                                         | `headings`: `keep`, `rem`, `drop`                                                                                                         |
| Indented, wholly italic, Quote-styled or short hand-broken lines                                 | `\q1`–`\q3` by indent depth                                   | `poetry`: `keep`, `unwrap`                                                                                                                |
| Footnotes and endnotes                                                                           | `\f + \fr c:v \ft …\f*`                                       | `notes`: `keep`, `drop`                                                                                                                   |
| Italic and bold spans                                                                            | `\it …\it*`, `\bd …\bd*`                                      | `italic`, `bold`: `keep`, `unwrap`                                                                                                        |
| Numbered or bulleted paragraphs                                                                  | `\li1`                                                        | `lists`: `keep`, `unwrap`                                                                                                                 |
| Paragraph styles named after a marker (`q2`, `s1 - Heading`)                                     | that marker                                                   | `styleMarkers`: `keep`, `unwrap`                                                                                                          |
| Comments, with replies and resolved state                                                        | `comments`, anchored by verse and offset into its plain text  | `comments`: `keep`, `drop`                                                                                                                |
| Anything else                                                                                    |                                                               | `markers` renames paragraph markers last, e.g. `{ q2: "q1", li1: "p" }`                                                                   |

**Verse numbers.** A number counts only if it is written the way the document writes its verse numbers, and only if it is the next verse (a jump of up to 10 for superscript or marked numbers, up to 3 otherwise). A number written with a thousands separator (`1,000`, `1.000`, `1 000`) never counts. When the caller passes `versification(chapter)`, a number above that chapter's verse count never counts either. Numbers that look like verse numbers but were refused are listed in `report.skipped`, with the reason. Bridges (`3-4`, `3–4`) are read as one verse, `\v 3-4`.

**Tracked changes** are accepted as they stand. `report.found.trackedChanges` counts them so a host can warn.

**A document that already holds USFM** (pasted into Word) is passed through as text, with `report.source === "usfm"`.

## XML

The reader uses the browser's `DOMParser`, which the Tauri webview also has. Under Node it loads `@xmldom/xmldom`, an optional peer dependency, by a dynamic import that a bundler leaves alone. You can pass `{ parseXml }` to supply your own.

## Running it

```sh
node packages/document-import/src/cli.ts packages/document-import/fixtures/master-titus.docx --book TIT
node packages/document-import/src/cli.ts <file> --json   # { usfm, report, comments }
```

Node 23.6 or later runs the TypeScript directly.

## Fixtures

- `master-titus.docx`: a real draft. Superscript numbers split across runs, blank paragraphs between paragraphs, "Chapter N" lines, a title line. 46 verses.
- `titus.docx`, `titus.odt`: the same text, raised with `w:position` in the Word copy. One comment on 1:1, which lands at the same verse and offset in both.
- `tit.usfm`: the ULB Titus, for comparing against.
