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
- **Choose the notes.** Choose English (en) in `gateway-language`, then
  Translation Notes in `resource-picker` (downloaded the first time). Wait
  (minutes on a slow line) for `[data-testid=notes-pane]`.
- **Follow.** Place the caret in a verse (mouse sequence, as in
  [edit and save](./edit-and-save.md)). `[data-testid=notes-pane]` gets a
  `data-place`. Move to another verse; `data-place` changes.
- **Proof.** Screenshot the pane after each move; record both `data-place`
  values. `errors()` is `[]`.

## Gotchas

- The download is per browser storage: a new session downloads again.
- Menus wait on a frame. On a hidden page, screenshot before deciding a
  menu item is missing.
- `remove` needs held notes and isn't walked here yet: its row is
  `[data-testid=reference-remove-notes]`.

Not walked end to end since the reference column was rebuilt in PR #9
(2026-10-26). The handles above are read from the code, not driven: walk it
and correct this file before trusting it. The `notes` tour still waits on
`[data-testid=reference-language]`, which PR #9 removed, so it stalls at
step 2.
