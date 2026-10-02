# History: what a selected version shows (2026-10-01, built)

Found in the PO-demo test drive. Built on master 2026-10-01 (`b4ea264`,
`6f8cfb6`); unpushed with the rest of master at the time of writing.

## Built, and what is left to test

Built:

- A version shows its own change (against its parent) by default.
- "Compared with your text now" is the explicit second view.
- History draws its changes with Review's own reader (`ReviewReader`), and
  `DiffView` is gone.
- **Adopt** on a card writes that version's wording into the buffer, as one
  unsaved edit that Undo takes back. It appears on hover where there is a
  fine pointer, and is always shown on touch.
- An **"Only on this device"** divider sits above versions the shared project
  does not have, with "On the shared project" below it. There is no divider
  when everything is shared.

Tested:

- **Fixture:** Adopt is hidden until hover. Adopting sets the verse, and the
  "now" view is then empty.
- **x-en-ulb** (38 versions, all shared): no divider, cards and Adopt render,
  and there are no errors.

To test:

1. **The divider when it should show.** Record a version with sending off,
   then open History. Expect "Only on this device" above that version.
   Don't do this in a project cloned from WycliffeAssociates/en_ulb; the
   sandbox is Will_Kelly/x-en-ulb.
2. **The sidebar.** History now takes over the left sidebar with its changed
   books, as Review does. Is that right for History, or should it keep the
   project sidebar?
3. **Adopt across a whole chapter.** Adopt a card in the whole-chapter view,
   then Undo. Expect one undo step.
4. **"Now" after Adopt** for a version several commits back. Expect only the
   passages Adopt did not take to remain.

## Second pass (Will's review, 2026-10-02, built)

- **No "Compared with your text now" toggle.** A version shows its own change,
  and nothing else.
- **Adopt on both sides of every card.** Left takes "before it", right takes
  this version, each written into your text as one unsaved edit. A side is
  disabled ("Your text already reads this way here") when your text matches it
  at that card. This replaces both the old Adopt and the "now" view's Take.
- **"Yours differs"** shows on a card's right caption only where your text
  differs from this version there. It opens a third row under the card: your
  text against this version, unified, read-only.
- **No whole-side adopt.** The per-book "Adopt all into your text" is gone;
  taking a book wholesale is Review's job. "Revert file" stays on the "Not yet
  recorded" row.
- **Dated captions:** "Before it · <date>" and "This version · <date>", in the
  reader's locale. The "before" date is that BOOK's previous version, not the
  commit's parent, so `Commit` needed no `parents`.
- Back to the editor is now `useBackToEditor()` plus a plain `<BackToEditor />`.
  Every page-level `PanelHeader` ends with it by default (shell.md).

Tested in the fixture: two versions recorded, then an unsaved edit. All three
Adopt/"Yours differs" states, the third row and Adopt-before behave as above.
Checked unified at 1440 px and split at 2200 px.

Not tested: a passage one side lacks (an added or removed verse), and
Undo after Adopt-before.

**Third pass (2026-10-02, built): History is the sidebar's History tab.**
Review and History share one sidebar panel with two tabs, Changes and History,
the way Zed's git panel does. The route picks the tab. The timeline lives in
the History tab, with Reload at its top, and the main area shows only the
selected version (`?commit=<id>`; the newest when none is given). The "Not yet
recorded" row, its Revert file, and the screen's own Save & Review are gone:
that row was the Changes tab. Save & Review is the way in for now. Opening this
panel from the editor, as Zed's left dock does, is not built.

Today a selected commit is diffed against the WORKING text ("Working text
against 3b83a12."), not against its parent. So:

- "Edited John" (3b83a12) shows "This version matches the text in hand",
  because John has not changed since. The commit's own change is invisible.
- "Edited Luke" (508216b) shows the LATER commit's Luke change (67f622a, the
  `C-shallow-…` junk), not what 508216b itself did.

Will's questions:

1. Should a selected version show what THAT version changed (commit vs its
   parent), as every history view people know does? Then "against working
   text" is a second, explicit comparison, not the default.
2. Read-only? Probably yes, with a per-hunk "revert this change", which means
   writing the old text into the current editor (Book.apply), never the file.
3. Do rows need to say local vs remote (recorded here and not yet pushed, or
   only on the shared project)?
4. The wording "Working text against <sha>" half-works; settle it with (1).

## Recommendation (Claude, 2026-10-01)

1. A selected version shows ITS OWN change by default: that commit against
   its parent. "Edited John" then shows the John change, not "nothing".
2. "Compare with your text now" is an explicit second action on a version,
   worded that way, replacing the default "Working text against <sha>".
3. Read-only, with "Restore this" per change: the old wording goes into the
   editor through Book.apply, never the file — an unsaved edit until Save &
   Review records it. "Revert file" becomes "Restore this book as it was".
4. Local vs remote only where it means something: a "Not shared yet" divider
   above unpushed versions, and the existing shallow-history card. No badge
   per row.

1 and 2 fix the confusion; 3 and 4 can follow.

## Decided (Will, 2026-10-01)

- A version shows its own change by default, like a dev tool's log. The
  confusion was exactly that it did not.
- "Compare with your text now" is a correct, explicit action, not the default.
- **Adopt this change**: not shown by default; offered on hover (or with a
  fine pointer). It writes that change into your buffer, nothing more — not
  a git revert, not a file checkout. An unsaved edit until Save & Review.
- Local vs remote: no marking while everything is shared. Only when there
  are local commits, a divider in the gutter area: "Only on this device".
- Open: where the explicit compare lives in the UI. The excerpt card is not
  set up as a compound component for a third row; one way is an editor with
  no margin by default and the compare as one more row tacked on below.

Priority: above the terms experiment.
