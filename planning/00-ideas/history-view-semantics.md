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
