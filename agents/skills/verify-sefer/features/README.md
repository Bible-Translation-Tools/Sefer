# Sefer feature map

The maintained source for verifying what a person can do in Sefer. Read
[the skill](../SKILL.md) first for launching, the doctor check, conventions and
cleanup; then use the matching file here as the recipe.

## Baseline

- A `pnpm verify:launch` instance (Web) or `pnpm verify:desktop` (desktop),
  started by this run. Never someone's own `pnpm dev`.
- One named agent-browser session (`--session verify`), so state never
  leaks into another run.
- `__sefer.observability.errors()` is `[]` before the first action.

## Each file

An H1 and one paragraph on what the person sees, then four H2s in this order:

1. `Sub-features`: short ids, one line each.
2. `How to get to it (user POV)`: every entry point a person uses.
3. `Driving it with agent-browser`: `Preconditions:`, then labelled steps,
   each pairing the action with the exact command and the result to see.
4. `Gotchas`: traps that waste a run or make it prove the wrong thing.

The last line says when it was last walked end to end, and what that walk
left out.

## Features

- [Edit and save](./edit-and-save.md): open a project, change a verse, Save &
  Review, and the version in History. The fixture is enough.
- [Migrate from Writer](./migrate-from-writer.md): Writer repos, a language's
  books, choosing between copies, Assemble, the replayed history. Needs the
  network.
- [Translation Notes](./translation-notes.md): choosing and downloading notes in
  the reference column, notes following the caret. Needs the network.
- [Find](./find.md): searching the project, and searching the notes beside it.

Not mapped yet: Findings, Key terms (`/terms`), Suggestions, Cloud sync
(needs a WACS account), import from a folder or zip, the character inventory.
Add each as it's next verified.
