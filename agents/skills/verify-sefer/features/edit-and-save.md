# Edit and save

A person opens a project, changes a verse, and keeps the change. Save never
writes straight away: ⌘S (Ctrl+S) opens Review, showing every change about to
be kept, and the file is written only when they press Save there. The kept
change is a version in History, under their name and message.

## Sub-features

- `open` opens a project from the projects page into its first book.
- `edit` changes text in the editor; the book shows as unsaved.
- `review` ⌘S lists the change, verse by verse, before anything is written.
- `record` Save with a name and a message writes the file and records a version.
- `history` the version appears in History with that message and name.

## How to get to it (user POV)

- Projects page → a project's **Open Project**.
- In a book, type in the editor.
- ⌘S / Ctrl+S, or the app bar's More menu → Save & Review.
- In Review, **Save**, then the two lines (name, what changed), then **Save**.
- History: the sidebar's History, or `/project/<slug>/history`.

## Driving it with agent-browser

Preconditions:

- A `verify:launch` instance at `<url>`; `--session verify` open on
  `<url>/projects?fixture=1`; `errors()` is `[]`.

- **Open.** Run `agent-browser --session verify find role button click --name "Open Project"`.
  The path becomes `/project/small-nt/book/PSA` and
  `[data-testid=editor-host] .cm-content` contains "Blessed is the man".
- **Place the caret.** Measure where to click with a DOM `Range` over the
  text, in `eval`:
  `const w = document.createTreeWalker(document.querySelector("[data-testid=editor-host] .cm-content"), NodeFilter.SHOW_TEXT)`;
  find the node containing "Blessed is the man", `range.setStart(node, i + 18)`,
  and return `x` and the middle `y` of `range.getBoundingClientRect()`. Then run
  `mouse move <x> <y>`, `mouse down`, `mouse up`.
- **Edit.** Run `agent-browser --session verify keyboard type " VERIFY"`. The
  editor now reads "Blessed is the man VERIFY".
- **Review.** Run `agent-browser --session verify press Meta+s`. The path is
  `/project/small-nt/review`, `[data-review-units]` shows "Psalms 1:1" with the
  old and new text, and `[data-review-record]` is present.
- **Record.** Click `[data-review-record]`. `snapshot -i` then shows the two
  textboxes "YOUR NAME, AS YOUR TEAM KNOWS YOU" and "WHAT DID YOU CHANGE?" and
  a **Save** button. `fill` both by ref, click that Save.
  `[data-review-record-done]` appears (the receipt's Done).
- **Proof.** Move to History inside the app (pushState + popstate, keeping
  `?fixture=1`). `[data-commits]` reads `1`, and its first item shows the
  message and the name you typed. Screenshot it to `$PWD/.verify/<runId>/history.png`.
  `errors()` is still `[]`.

## Gotchas

- `.click()` on the editor places no caret; only the mouse sequence does.
- A reload (`open` again) re-seeds the fixture and drops the edit and the
  version. Navigate inside the app.
- There are two buttons named **Save** in Review once the form is open (the
  one that opens it and the form's own). Use the snapshot's refs.
- On the fixture the file is in memory, so History is the side effect to
  check. On desktop, check the bytes on disk instead (the desktop smoke spec,
  `e2e-desktop/smoke.desktop.ts`, reads the file and the git head).
- Settings has "Skip review of my changes". With it on, ⌘S saves at once and
  there is no Review step. A fresh session has it off.

Last walked end to end: 2026-10-27, Web, fixture (`.verify/2026-10-27T16-11-57-459Z-9cc68c65/`).
Not walked: the More menu entry point, desktop.
