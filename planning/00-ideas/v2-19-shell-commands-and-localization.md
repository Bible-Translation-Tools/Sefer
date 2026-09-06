# 19 — Commands, settings, routing, and localization

Status: proposed, grows with each capability. Prerequisite: [01](v2-01-boot-and-composition.md). Owns: application interaction shell, not domain state.

## Outcome and increments

1. Expose the first open/save/mode/navigation commands through a small shared command boundary usable by menus and keybindings. Availability follows current state and capability; do not duplicate business rules in toolbar handlers.
2. Make route transitions select project/book/view without becoming the source owner. Restore meaningful navigation while respecting missing resources and removed chapters.
3. Classify settings as global, project, or ephemeral view state. Port user jobs rather than every legacy toggle. Persist only durable preferences with a versioned, recoverable shape.
4. Prove Lingui core integration with Solid and message extraction for one real screen. Introduce keyboard/focus/dialog primitives as needed and keep language/font resources available offline.

## Contract and failures

Localized strings do not become identifiers, source offsets, or persisted command names. Invalid settings fall back explicitly without deleting project data. A disabled action cannot be invoked indirectly to bypass read-only or busy-state checks. Route changes do not silently destroy dirty work.

## Useful proof

One real keyboard journey opens a book, edits, saves, and navigates back without losing state. A small locale/settings reload check protects persisted identity and extraction. Use accessible behavior checks for selected controls; avoid snapshots of every translated label or a new test for every trivial command wrapper.

## Open questions

Which settings survive the rewrite, and which represent obsolete modes? What keyboard conflicts exist across native menus, CodeMirror, and script input methods? Which Solid RC and Lingui integration is actually viable? TanStack Router is scaffolded; Query/Table/Virtual and a broad UI kit require specific jobs, not matching brand names. See [08](v2-08-input-and-accessibility.md).
