# Import from Word or LibreOffice

A translator brings a draft written in Word (`.docx`) or LibreOffice (`.odt`) into any book of the project, open or not: they choose the file, see what was found, pick the book and chapters, preview the result as text, USFM or the changes against the book now, and Import replaces those chapters as one edit that one Undo takes back.

## Sub-features

- `read`: the file is read; the dialog says how many verses in how many chapters.
- `target`: the book the import goes into. Unchosen, it is the one project book the document's opening lines name ("MASTER Titus", "Psalms draft"), else the open book.
- `scope`: the Chapters box takes a citation (`PHM 1`, `TIT 2-3`); empty is every chapter the document holds. The book list under it (the sidebar's rows) writes the same box: a book's row picks it whole, a chapter tile that chapter, Shift with a tile a range, the one picked tile again the whole book.
- `keep`: "Try to keep this book's paragraphing" lays the book's own paragraph markers back over the document's.
- `front`: "Keep this book's front matter" (on) keeps the book's header; off, the document's text before chapter 1 replaces it, under the book's `\id`.
- `labels`: a replaced chapter keeps the book's `\cl` when the document gives it none.
- `switches`: one switch per kind of guess the document gave occasion for (poetry, headings, text before verse 1, footnotes, italic, bold, lists, styles named after markers).
- `advanced`: the verse-number convention and the chapter words.
- `preview`: Result shows the replaced chapters in an editor view; Changes shows the whole book before against after, with Review's book diff. The View menu beside them is Review's (which changes, side by side or one text, USFM markup); the layout is Review's own setting, shared.
- `import`: one trusted edit; one Undo restores the book. Into a book that is not open, the app goes there.

## How to get to it (user POV)

- Open a project, then the command palette (`Mod-k`), and run **Import from Word or LibreOffice…**. It is in the palette only; it needs an open project, not an open book.

## Driving it with agent-browser

Preconditions: the fixture (`?fixture=1`) has Psalms, Philemon, 3 John and Jude, so use a document of one of them. The package's fixtures are Titus. A small `.docx` with superscript verse numbers can be generated with `fflate` (three parts: `[Content_Types].xml`, `_rels/.rels`, `word/document.xml`); change one word so the import shows, and give it an opening line naming the book ("Psalms draft") to see the target guessed. A multi-chapter one (Psalms 1–3, "Chapter N" lines) is what proves an import across chapter headings.

1. Open a book that is NOT the document's: Open Project on small-nt, then Philemon › 1 in the sidebar. Use a viewport of at least 1600×1000 (`set viewport 1600 1000`).
2. Run the command: `press Meta+k`, type "Import from Word", Enter. The dialog shows (`[data-import-document]`).
3. Choose the file: `upload "[data-import-document-file]" <absolute path>`. `[data-import-document-summary]` reads "26 verses in 3 chapters"; in `[data-import-document-books]` the row with `[data-focused]` is Psalms (the guess), and its tiles 1, 2, 3 are `aria-pressed="true"`.
4. Scope: typing in the Chapters box narrows the book list (`ju` leaves Jude); Enter takes the box at once, or the first book listed when the text names no chapters; Escape clears a non-empty box and leaves the dialog open. Click tile 2 in the open row; the Chapters box reads `PSA 2`. Shift-click 3: `PSA 2-3`. Click the Psalms row header: `PSA`. Typing `XYZ 1` gives "XYZ is not in this project" in `[data-import-document-notes]` and Import (`[data-import-document-confirm]`) is disabled.
5. Preview: the segmented control over the preview (Result, Changes) and the View menu. Changes shows `[data-import-document-changes]`, the whole book with change bars, side by side ("Before import", "After import") at 1600 px wide; Result shows `[data-import-document-preview]`. Click it with `eval` (`[...document.querySelectorAll("[role=dialog] button")].find(b => b.textContent.trim() === "Changes").click()`): the dialog's overlay covers agent-browser's own click point.
6. Import: click `[data-import-document-confirm]`. The dialog closes, the path is `/project/small-nt/book/PSA`, and the editor's `.cm-content` holds the changed word.
7. Undo: the toolbar's Undo (`button "Undo"`) once. The original word is back, and Undo is disabled (the import was one step). `__sefer.observability.errors()` is `[]`.

## Gotchas

- The fixture resets on reload; drive the palette from inside the app.
- The hidden file input is the handle; agent-browser's `upload` sets it directly.
- The Chapters box and the chapter words wait 250 ms after typing before the preview changes; read the notes after a pause.
- The preview is an editor view: it paints only when a screenshot renders a frame.
- After an import into a book that was not open, focus is not in the editor, so `Meta+z` does nothing; use the toolbar's Undo.
- Hot reload of the dialog's module closes it (its cleanup closes it with the project); reopen it.

Last walked end to end: 2026-10-30 (twice, the second with the View menu, side by side, the typed filter, Enter and Escape), steps 1–7 on the Web fixture with a generated Psalms 1–3 `.docx`, Philemon open (target guessed, Changes view, import across `\c 2` and `\c 3`, navigation to Psalms, one Undo). 2026-10-29: the Philemon walk, Cancel and reopening, the same file chosen twice. Not walked: `.odt`, footnotes, the Advanced settings, front matter off, a book with chapter `\cl` labels in the app (checked headless), desktop.
