# Every event, and which are operations

2026-09-16. Discussing. Vocabulary settled in `documentation/glossary.md`; the
argument for it is in [observability-glossary](observability-glossary-2026-09-16.md).
Companion to [ui-state-stores](ui-state-stores-2026-09-16.md), which audits
what the UI recomputes where this audits what the application says it did.

## The rule this applies

An **operation** is one end-to-end piece of work — one thing a person did, or
one piece of background work no Gesture caused. It is a wide event: written
once, when the work finishes, carrying everything known by then.

Inside it:

- a **span** is a hop that crosses a boundary and can vary or fail on its own —
  a file write, a Galley parse, an `invoke` into the desktop host
- an **event** is a point in time inside the work — a decision, a refusal, a
  derivation
- **fields** are everything else: ids, counts, sizes, and durations too small
  for a browser's clock to resolve

Work that merely *followed* — anything debounced or coalesced — is its own
operation carrying `op.cause`, never a child. One analysis pass serves several
keystrokes; a parent would have to name one of them and lie.

## Shipped

| Operation | Opened by | Carries |
|---|---|---|
| `boot` | the application starting | `session.id`, `build.id`, `app.host`, `boot.phase` |
| `project.open` | opening a Project | `project.root`, `project.books`; metadata, Seats and Baselines inside it |
| `save` | Record a version | `book.id`, `fs.path`, `fs.bytes`, `book.revision`; `file.write` inside it |
| `analysis.pass` | **caused by** the Gestures that armed it | `analysis.books`, `analysis.refreshed`; `galley.parse` and `corpus.publish` inside it |
| `editor.mutation` | a Gesture that changed Source | book, revisions, phase timings, derive totals, broadcast, meter |
| `editor.selection` | a Gesture that moved the caret | the same, minus the mutation |
| `editor.render` | a repaint nobody typed for | derive totals, `findings.shown` |
| `import.resource` | importing a picked folder or ZIP | source kind, stage timings, classification, book/file counts, outcome and failing phase |
| `import.remote` | cloning a shared project | clone and registration timings, progress counts, outcome and failing phase; no URL or name |
| `find.run` | running a nonempty, valid-length search | scope, options, scan time, hit count or refusal reason; never the query text |
| `sync.transfer` | pressing the transfer action after any confirmation | action, transfer time, outcome and failure reason |
| `review.apply` | applying a review plan | requested/written counts, target side, duration and refusal reason |
| `journal.offer` | checking disk and journals when a project opens | candidate, offered and declined counts |
| `journal.restore` / `journal.discard` | answering the recovery banner | attempted, completed and refused book counts |

Inside those, as spans: `galley.parse` (with `galley.why` naming its caller),
`file.write`, `corpus.publish`.

As events: `book.analyze`, `corpus.update`, `corpus.reference`,
`baseline.adopt`, `seat.open`, `seat.close`, `project.metadata`, `book.apply`
(only when no Gesture is open), `journal.*`, `conflict.resolve`, `library.*`.

## Not yet operations

| Should open | Caused by | Why it is not yet |
|---|---|---|
| `project.close` | a Gesture | Mechanical; `project.open`'s shape applies directly. |
| `journal.write` | **cause** — the Gesture that dirtied the Book | Debounced, so it needs the same `supply`-style hand-off the analysis pass uses. |
| `journal.pending` | startup | The raw pending-list operation remains separate from the open-time `journal.offer` check. |
| `project.watch` | uncaused | A watcher declining is nobody's Gesture. Root of its own. |
| `file.changed` | uncaused | The watcher saw disk change. Root of its own. |

## Still silent

The remaining gaps after the import, recovery, Find, transfer and review Apply passes:

- **Browsing the remote catalogue** remains silent. Once a repository is
  selected, clone and local registration run under `import.remote`. The Web
  picked-source path reports read/unzip and stage/classify/commit time, but
  neither import path emits a per-file event.
- **Review comparison** runs in response to source and text changes, but only
  Apply now has an operation. A coalesced comparison should report the inputs'
  identities and changed-book count when its performance becomes a question.
- **Cloud state survey and incoming-plan construction** remain silent; the
  transfer button is covered, including failures.
- **Terms and Inventory** remain silent. Find now records scans and outcomes.

Those four are the largest remaining surface, and three of them are where the
network and the filesystem are.

## Open, and worth deciding before the silent screens

- **Does every Gesture get an operation?** A palette command toggling a boolean
  is a Gesture and is not interesting. Agreed proposal: the command registry
  opens one for every command and the level decides whether it is recorded — a
  policy rather than a judgement made once per command.
- **`seat.open` / `seat.close` happen both inside `project.open` and later on
  their own.** Nested when inside, their own operation when not, which the DI
  model gives for free: whichever service they receive decides.
- **`journal.pending` runs before there is a Project.** Inside `boot`, or its
  own operation beside it?

## What the instrument has already found

Kept here because the argument for doing any of this is that it pays.

- **`dirty()` parsed the whole Book to compute a hash**, on every reactive read,
  per badged Book per keystroke — about 4.5 full engine parses per key pressed.
  The comment above it read "a per-save parse, never a per-keystroke one".
- **`project.open` fires repeatedly** — 8 times in one session, each re-parsing
  every Book in the Project. Still unexplained, and now countable.
- **Passes that do nothing**: `analysis.pass` with `analysis.books: 0`.
- **A keystroke costs 33–45ms to paint with 3–8ms of JS**, where a caret move
  costs ~16ms. The gap is inside the browser, so it wants a DevTools profile
  rather than more spans.
