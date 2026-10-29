# Translation Notes

A person reads WA's Translation Notes beside their text. They choose the
notes in the reference column's menu, which downloads them the first time,
and the notes for the verse under the caret appear beside it, moving as the
caret moves.

## Sub-features

- `choose` the reference column's two-part dropdown: the language on the left, the texts and notes in that language on the right.
- `download` the first choice downloads them (en_tn is about 8.5 MB), with a progress toast.
- `follow` the notes pane shows the caret's verse and moves with it.
- `remove` held notes can be removed from this device, in the same menu.

## How to get to it (user POV)

- In a book, the app bar's **Show reference**, then the column's dropdown:
  the language half, then the text half.

## Driving it with agent-browser

Preconditions:

- A `verify:launch` instance, a fresh `--session verify`, and the network.
  Notes are read beside a real project, not the fixture.

- **A project.** Open
  `<url>/r/Will_Kelly/leb-x-bisa_reg/book/JHN?host=content.bibletranslationtools.org`.
  Press the download button (`[data-tour=open-by-link-download]`); the
  editor (`[data-testid=editor-host]`) appears when the project arrives.
- **The column.** Turn on **Show reference**. `aside[data-references]` and
  `[data-testid=gateway-picker]` appear: `[data-testid=gateway-language]` on the
  left, `[data-testid=resource-picker]` on the right.
- **Choose the notes.** With English on the left, click
  `[data-testid=resource-picker]`; `snapshot -i` lists the menu items
  "Unlocked Literal Bible" and "Translation Notes". Click "Translation Notes"
  by ref (it downloads the first time). Wait (about 25 s here; minutes on a
  slow line) for `[data-testid=notes-pane]`.
- **Follow.** The pane opens already on a place (`data-place` "JHN 1").
  Place the caret in verse 2 (mouse sequence, as in
  [edit and save](./edit-and-save.md); "Uyu wine" is in JHN 1:2): `data-place`
  reads "JHN 1:2". Then in verse 3 ("Ifintu"): "JHN 1:3".
- **Proof.** Screenshot the pane after each move; record both `data-place`
  values. `errors()` is `[]`.

## Gotchas

- The download is per browser storage: a new session downloads again.
- Menus wait on a frame. On a hidden page, screenshot before deciding a
  menu item is missing.
- `remove` is the menu item "Remove Translation Notes from this device"
  (`[data-testid=reference-remove-notes]`), shown once notes are held. Not
  walked yet.
- The pane opens already showing a place, so a check for "`data-place` is not
  empty" passes before anyone has clicked. Check that it changes.
- In zsh, a variable holding "x y" is one word: use `mouse move ${=P}`.

Last walked end to end: 2026-10-27, Web, through the `notes` tour, fixed
the same day (`.verify/2026-10-27T16-20-09-158Z-0a0f1cf7/`). The download took
about 25 s. Not walked: `remove`, desktop.
