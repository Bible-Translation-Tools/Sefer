# Book names

A translator checks and edits what each book is called, all books in one dialog: the lines before the first `\c` that name the book (running head, long and short name, abbreviation, main title, remarks, and any marker Sefer doesn't know), a book at a time. A book whose project list (manifest) calls it something other than its short name (`\toc2`, else `\h`), or that has no short name, gets a finding.

## Sub-features

- `rows`: every line before the first `\c` filed under identification, document structure or a title row (`\id \usfm \ide \h \toc1-3 \toca1-3 \rem \sts \mt \mte`, and unknown markers). Introductions, `\cl` (Chapter labels owns it), `\s`, `\ms`, `\d` are not shown.
- `fixed`: `\id`, `\usfm` and `\ide` are shown as text, not fields.
- `edit` / `take-out`: any other field can be changed; the bin empties it, and an empty field takes the line out on save. The emptied field stays, so it can be filled again.
- `missing`: a book lacking `\h`, `\toc1-3` or `\mt` shows each as an empty field ("Not written"); filling one writes the line in the usual order (`\id \usfm \ide \h \toc1-3 \mt`).
- `flick`: the book select and the arrows step through the books; a book with unsaved edits has `•` after its name.
- `save`: Save names applies every edited book at once (`bookNames.save`).
- `listed`: "Project list says “…”" over a book whose manifest name in the project language differs from its short name.
- `finding`: `bookName.manifest` / `bookName.missing` marks on the book, and one `bookNames.differ` summary in Findings, named "Book names".

## How to get to it (user POV)

- Main menu (☰) › **Book names…**.
- The command palette: **Book names**.
- A book-names mark in the editor: **Review book names…**.

## Driving it with agent-browser

Preconditions: the fixture (`?fixture=1`) is enough for rows, edits, missing and the `missing` finding. It has no manifest, so `listed` and `bookName.manifest` need a real project with one (a merged repo such as `reuben-catalog/merged-ilb-x-lundwe`, whose manifest has English titles). Use a viewport of at least 1440×1000 (`set viewport 1440 1000`): at 1280×633 the design panel covers the menu's lower items.

1. Open: Open project on small-nt, then the ☰ button (`button "Menu"`) and `menuitem "Book names…"`. The dialog opens on Psalms with Book code and Encoding as text, and Running head, Long name, Short name, Abbreviation and Main title as fields. No `\cl` row.
2. Edit: `button "Next book"` → `combobox "Book 2 of 5"` reads Philemon. `fill` the `textbox "Short name"` with a new name. Next → 3 John; click `button "Take out Running head"` and `button "Take out Short name"`: both fields stay, empty. The select shows `•` after edited books. Click `button "Save names"`.
3. Prove the edit: reopen the dialog; Philemon's Short name reads the new name; 3 John shows Running head and Short name empty. ☰ › Alerts: a "3JN front" group with "1 book has no short name", code "Book names", and the excerpt shows the header without `\h` and `\toc2`.
4. Missing: in 3 John fill Short name, Save. The "3JN front" group is gone. Reopen: Short name sits between Long name and Abbreviation (the line went in after `\toc1`).
5. `__sefer.observability.errors()` is `[]`.

## Gotchas

- The fixture resets on reload: drive edits and their proof in one load.
- Sidebar book rows aren't in `snapshot -i`; reach a book through the dialog's select, not the sidebar, when driving the dialog.
- Undo is per book (the focused book's history). The Undo in the app bar is disabled while the focused book wasn't one the save changed.

Last walked end to end 2026-11-12 on the Web fixture: open, flick, edit, take out, missing rows, save, the `missing` finding and its summary, refill and its insertion order. Not walked: `listed` and `bookName.manifest` (needs a project with a manifest), Undo after a save, the editor mark's "Review book names…" action, the desktop app.
