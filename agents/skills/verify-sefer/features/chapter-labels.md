# Chapter labels

The word a book puts before its chapter numbers (`\cl`). In Refine a chapter's
title is its own label, else the book's label and the number ("Psalm 1"),
else the number alone ("1"); there is no interface word in front. Clicking a
title opens the Chapter labels dialog: one row per book with labels, a word
for every book, adding a word to books without one, and the repair of a label
whose number is not its chapter's.

## Sub-features

- `book-label`: a `\cl` before `\c 1` names every chapter and is never shown as a line of its own.
- `numbers-only`: a book with no label shows its numbers alone; with none in the project the dialog says that is fine and offers "Add a word".
- `add-word`: "Add a word" / "Add a word to the N books without one" lists every book; "Use for every book" sets them all.
- `standardize`: Standardize writes one book label per chosen book (`chapterLabels.standardize`).
- `fix`: a label with a word and the wrong number ("Chapter 1: Pasal 8") gets "Use 1" (its chapter's number in the label's own digits) and "Remove" (`chapterLabels.fix`); the dialog stays open and the row updates.

## How to get to it (user POV)

- Refine: click a chapter's title (the number, or its label).

## Driving it with agent-browser

Preconditions: the fixture. Psalms has `\cl Psalm` before chapter 1; the
other books have no labels.

1. **Book label**: open Psalms (`history.pushState` to `/project/small-nt/book/PSA?fixture=1`). The first lines of `.cm-content` read `"", "Book One", …`, and the title is "Psalm 1" — no line reading "Psalm".
2. **Numbers only**: open Philemon. `getComputedStyle(document.querySelector(".usfm-chap-named .usfm-num-c"), "::before").content` is `none`; the title reads "1".
3. **Open**: measure that title's centre and `mouse move` / `mouse down` / `mouse up` on it. The dialog shows Psalms and "Add a word to the 4 books without one".
4. **Add a word**: `find text "Add a word to the 4 books without one" click`, `find placeholder "A word, such as Chapter" fill "Pasal"`, `find text "Use for every book" click`. Every `[data-chapter-labels-book]` row's select reads "Another word" with "Pasal" in its field. `find testid chapter-labels-standardize click`: Philemon's title `::before` is `"Pasal "`, and Psalms reads "Pasal 1".
5. **Fix**: toggle USFM mode (`press Meta+Shift+m`), put the caret at the end of `\c 1` with a real click, `press End`, `press Enter`, `keyboard type '\cl Chapter 8'`, toggle back. Click the title ("Chapter 8"). Philemon's row lists "Chapter 1: Chapter 8 (the number is not this chapter's)" with `chapter-labels-renumber` ("Use 1") and `chapter-labels-remove`. Remove: the row goes (Philemon has no label left) and the title is "1"; Use 1: the title reads "Chapter 1".

## Gotchas

- The fixture resets on reload: a word added in step 4 is gone after one.
- `agent-browser eval` shares one scope across calls on a page: wrap a script in `(() => { … })()` or a second `const` with the same name fails.

Last walked end to end 2026-11-17 (Web, fixture), all five steps. Not walked: a real project's Devanagari labels (the renumbering in the label's own digits was checked on the function alone), desktop.
