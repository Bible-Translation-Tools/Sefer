# History: what a selected version shows (2026-10-01, deferred)

Found in the PO-demo test drive. Not for the demo.

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
