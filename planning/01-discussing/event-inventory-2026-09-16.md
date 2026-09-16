# Every event, and which are operations

2026-09-16. Discussing. The companion to
[ui-state-stores](ui-state-stores-2026-09-16.md): that one audits what the UI
recomputes, this one audits what the application *says* it did.

## The rule this applies

An **operation** is one end-to-end piece of work — in practice, one thing a
person did, or one piece of background work no gesture caused. It is a wide
event: written once, when the work finishes, carrying everything known by then.

Inside it:

- a **span** is a hop that crosses a boundary and can vary or fail on its own —
  a filesystem write, an engine parse, an `invoke` into Rust
- an **event** (`note`) is a point in time inside the work — a decision, a
  refusal, a derivation
- **fields** are everything else: ids, counts, sizes, durations too small for a
  clock to resolve

Work that merely *followed* from a gesture — anything debounced or coalesced —
is its own operation with `op.link` back, never a child. One analysis pass
serves several keystrokes; a parent would have to name one of them and lie.

## Today

The editor is the only door that opens an operation. Everything else is a bare
span or note with no `trace`, so `traces.recent()` shows typing and nothing
else, and `logs.recent()` holds the rest.

| Emitted today | Kind | Should be |
|---|---|---|
| `boot` | span + note | **operation** — the application starting is the first end-to-end work there is |
| `shell.services` | note | field on `boot` |
| `fixture` | note | field on `boot` (dev only) |
| `project.open` | span + 4 notes | **operation**, with `project.metadata`, per-book opens and refusals as events inside |
| `project.instantiate` | note | event inside `project.open`, or its own operation when a seat is taken later |
| `project.release` | note ×2 | event inside whatever gesture released it |
| `project.close` | note | **operation** |
| `project.watch` | note | **operation**, uncaused — a watcher declining is not part of any gesture |
| `project.metadata` | note | event inside `project.open` |
| `save` / `save.write` | span + 4 notes | **operation** per book saved, `save.write` the filesystem span inside it |
| `save.adopt` | note ×2 | event inside `project.open` (it adopts on open) |
| `save.external` | note | **operation**, uncaused — the watcher saw disk change |
| `save.resolve` | note ×2 | event inside the gesture that resolved it |
| `analyze` | span + note | span inside `analyze.project`, never on its own |
| `analyze.project` | span + note | **operation**, linked to the transactions that armed it |
| `analyze.publish` | span + note | span inside `analyze.project` |
| `analyze.corpus` | note | event inside `analyze.project` |
| `analyze.reference` | note | event inside `analyze.project` |
| `galley.analyze` | span + note | span, wherever it is called from — already carries `galley.why` |
| `recovery.journal` | note ×2 | **operation**, linked — the journal write is debounced |
| `recovery.compact` | note | event inside `save` (it follows a write) |
| `recovery.pending` | note ×2 | **operation** — the scan at startup |
| `recovery.restore` | note ×2 | **operation** — a gesture |
| `recovery.reopen` | note | **operation** — a gesture |
| `recovery.discard` | note | event inside the gesture that discarded |
| `library.load` / `library.add` | note | events inside an import **operation** that does not exist yet |
| `book.apply` | note ×4 | fields on `editor.mutation` — **done** |
| `editor.transaction` | operation | renamed `editor.mutation` / `editor.selection` — **done** |
| `editor.render` | operation | repaints nobody typed for — **done** |
| `editor.sous` | note | event inside the gesture that republished |
| `editor.close` | note | event inside the gesture that closed it |
| `keystroke` | note | fields on `editor.mutation` — **done** |

## Operations, once this lands

Named, with what each carries. This is the list `traces.recent()` should be
able to show, and the argument for the list is that each is something a person
either did or waited for.

| Operation | Caused by | Carries |
|---|---|---|
| `boot` | the app starting | `app.host`, `build.id`, `session.id`, phase timings, fixture |
| `project.open` | opening a project | `project.root`, `project.books`, per-book events, `analyze.project` |
| `project.close` | closing one | book count, unsaved count |
| `editor.mutation` | a keystroke that changed text | done — book, revisions, phases, derives, broadcast, meter |
| `editor.selection` | a keystroke that moved the caret | done |
| `editor.render` | a repaint nobody typed for | done — derive totals, coalesced count |
| `save` | Record a version | book, bytes, revision, `save.write` span, `recovery.compact` |
| `analyze.project` | **linked** to the transactions that armed it | books refreshed, `galley.analyze` spans, `analyze.publish` |
| `recovery.journal` | **linked** to the transaction that dirtied the book | journal id, entries |
| `recovery.pending` | startup | journals found |
| `recovery.restore` / `recovery.reopen` / `recovery.discard` | a gesture | journal id, book, entries |
| `project.watch` | uncaused | why the watch stopped |
| `save.external` | uncaused | book, what changed on disk |
| `import.resource` | a gesture | **does not exist yet** — url, bytes, entries, files written; `library.add` inside |
| `compare` / `review.apply` | a gesture | **not inventoried** — `src/core/compare`, `src/core/save` |
| `sync.*` | a gesture or a poll | **not inventoried** — `src/core/sync` |
| `terms.*`, `find`, `inventory` | a gesture | **not inventoried** |

## Gaps this survey found

- **Three screens emit nothing at all.** Review/compare, cloud sync, and terms
  have no observability call sites. They are also the three with the most
  network and filesystem work, which is exactly where a trace earns its keep.
- **Import has no events**, only `library.load` / `library.add` at the end of
  it. The download → unzip → write cascade is the worked example everyone
  reaches for when explaining why spans exist, and it is uninstrumented.
- **`work`, `silent`, `probe`, `outer`, `inner`, `kept`, `ignored`, `r`,
  `recorded`** are test fixtures, not application events. Listed only so the
  count reconciles.

## Order

1. `boot` — smallest, and it makes `traces.recent()` non-empty on every load,
   which is how anyone will first check this works.
2. `project.open` — biggest single cost measured so far (~66 parses), and the
   one whose repeated firing is still unexplained.
3. `save`, then `recovery.*` — a gesture each, mechanical once the pattern is set.
4. `analyze.project` — first use of `op.link`, so it settles the linking shape.
5. `import.resource` — needs the operation to exist before the cascade can hang
   off it.
6. Review, sync, terms — currently silent, and the largest new surface.

## Open

- Does every gesture get an operation, or only those that do work? A palette
  command that toggles a boolean is a gesture and is not interesting. Proposal:
  the command registry opens one for every command and the level decides
  whether it is recorded, so the answer is a policy rather than a judgement made
  once per command.
- `project.instantiate` and `project.release` happen both inside `project.open`
  and later on their own. Nested when inside, their own operation when not —
  which the DI model gives for free, since whatever service they receive decides.
