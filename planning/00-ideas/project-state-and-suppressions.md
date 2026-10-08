# Project state: suppressions, approvals, and where they live (2026-10-06)

**Status:** idea, undecided. Parked by Will on 2026-10-06 so that the
[Writer migration](consolidate-book-repos.md) gets built first. Nothing here
is agreed.

## The need

Several features want state that belongs to a project and outlives a
session:

- **Lint and proofreading suppressions.** "This onion or Sous finding is not a
  problem here."
- **Key-term approvals.** PR #5 ("Spiritual terms: edit tracking, locked verse
  numbers, Save changes / Cancel") tracks "Approve" and "Approve with edits" on
  `/terms`. Will does not plan to accept that PR as is, but the feature needs
  this state.
- **Reference picks** (decided 2026-10-06): which source text the reference
  column shows for a project. These are per device, in `.sefer/project.json`.

## The question to decide

Is a suppression or an approval this person's state or the team's?

- **Per device** (`.sefer/`, which intake keeps out of every commit):
  - simple, and it never conflicts;
  - but each teammate approves and suppresses again, alone.
- **Shared and committed:**
  - a teammate sees that Mary approved "love" at Jude 1:21;
  - but it needs a committed home and a rule for sync conflicts, because
    Review only judges scripture text.
  - `.upstreams.json` (Writer migration) is the first committed file of this
    kind. A second one is the moment to choose:
    - one dotfile per concern;
    - or one committed Sefer folder, separate from `.sefer/`.

## Also open

- **The key.** What identifies a suppression or an approval so that it
  survives unrelated edits, but reopens when the verse changes? For example:
  the verse address, the rule or term, and a hash of the verse text.
- **Whether suppressions and approvals are one mechanism or two.**
