# Import from Word or LibreOffice

A translator brings a draft written in Word (`.docx`) or LibreOffice (`.odt`) into the book they have open: they choose the file, see what was found, name the chapters, preview the result, and Import replaces those chapters as one edit that one Undo takes back.

## Sub-features

- `read`: the file is read; the dialog says how many verses in how many chapters.
- `scope`: the Chapters box takes a citation (`PHM 1`, `TIT 2-3`); empty is every chapter the document holds.
- `keep`: "Try to keep this book's paragraphing" lays the book's own paragraph markers back over the document's.
- `switches`: one switch per kind of guess the document gave occasion for (poetry, headings, text before verse 1, footnotes, italic, bold, lists, styles named after markers).
- `advanced`: the verse-number convention and the chapter words.
- `preview`: the result in an editor view, with a USFM toggle that starts from the editor's mode.
- `import`: one trusted edit; one Undo restores the book.

## How to get to it (user POV)

- Open a book, then the command palette (`Mod-k`), and run **Import from Word or LibreOffice…**. It is in the palette only; the command needs an open book.

## Driving it with agent-browser

Preconditions: the fixture (`?fixture=1`) has Psalms, Philemon, 3 John and Jude, so use a document of one of them. The package's fixtures are Titus. A small Philemon `.docx` with superscript verse numbers can be generated with `fflate` (three parts: `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`); change one word so the import shows.

1. Open the book: Open Project on small-nt, then Philemon › 1 in the sidebar.
2. Run the command: `press Meta+k`, `fill <palette box> "Import from Word"`, click **Import from Word or LibreOffice…**. The dialog shows (`[data-import-document]`).
3. Choose the file: `upload "[data-import-document-file]" <absolute path>`. `[data-import-document-summary]` reads "25 verses in 1 chapter" and the preview (`[data-import-document-preview]`) shows the changed word.
4. Scope: `fill "[data-import-document-scope]" "JUD 1"` gives "Open JUD first…" in `[data-import-document-notes]` and Import (`[data-import-document-confirm]`) is disabled; `"PHM 2"` gives "The document holds no chapters in this range"; `"PHM 1"` enables Import.
5. Keep: turn the switch off and the preview shows the document's own paragraphs; on, the book's.
6. Import: click `[data-import-document-confirm]`. The dialog closes and the editor's `.cm-content` holds the changed word.
7. Undo: the toolbar's Undo once. The editor holds the original word again, and Undo is disabled (the import was one step). `__sefer.observability.errors()` is `[]`; `traces.recent()` ends with `command.book.undo` and `journal.write`.

## Gotchas

- The fixture resets on reload; drive the palette from inside the app.
- The hidden file input is the handle; agent-browser's `upload` sets it directly.
- The Chapters box and the chapter words wait 250 ms after typing before the preview changes; read the notes after a pause.
- The preview is an editor view: it paints only when a screenshot renders a frame.

Last walked end to end: 2026-10-29 (twice, the second after the review fixes, adding Cancel and reopening and the same file chosen twice), steps 1–7 on the Web fixture with a generated Philemon `.docx`. Not walked: `.odt`, footnotes, the Advanced settings, desktop.
