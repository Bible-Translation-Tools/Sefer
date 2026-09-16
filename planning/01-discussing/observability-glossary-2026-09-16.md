# What things are called, and why

2026-09-16. Discussing. Gates
[event-inventory](event-inventory-2026-09-16.md) — the names have to be settled
before a hundred of them get written down.

The problem this fixes: `analyze` currently means four different things.
`analyze` (a book finished), `analyze.publish` (all books compared),
`analyze.corpus` (one book registered), `galley.analyze` (the engine read some
text). Nobody can hold that, including the person who wrote it.

## The rule

**`<thing>.<what happened to it>`** — the thing is a noun from the glossary
below, the verb says what became of it.

Not `<subsystem>.<function name>`. `analyze.publish` names the module that
happens to contain the code. `corpus.publish` names what exists afterwards: a
published corpus. When the code moves, the second name is still true.

One word, one meaning, everywhere — in events, in types, in conversation.

## The things

In `documentation/glossary.md`, which is canonical — Source, Book, Source
stamp, Seat, Satellite, Galley, Analysis, Corpus, Publication, Finding,
Baseline, Journal, Gesture. This file argues for the names; that file records
them. Where an earlier draft of this document invented a term that the glossary
already had (`Text` for Source, `Stamp` for Source stamp), the glossary wins.

## The verbs

Use these, and not synonyms of them.

| Verb | Means | Example |
|---|---|---|
| `open` / `close` | a lifetime began or ended | `project.open` |
| `read` / `write` | bytes moved to or from disk | `file.write` |
| `parse` | text went into the engine, a reading came out | `galley.parse` |
| `update` | a registry now knows about this | `corpus.update` |
| `publish` | a whole snapshot was produced | `corpus.publish` |
| `apply` | an edit was accepted into a book | `book.apply` |
| `refuse` | a rule said no, and nothing changed | verdict, not a name |
| `restore` / `discard` | crash-safety state was used or dropped | `journal.restore` |

## The renames

| Today | Becomes | Because |
|---|---|---|
| `galley.analyze` | `galley.parse` | It is one pass over text. "Analyze" suggested a second, separate proofreading step; there isn't one, and there should never be. |
| `analyze` | `book.analyze` | The thing that happened is that a BOOK now has a fresh Analysis. Naming it after the scheduler said where the code lives, not what is true. |
| `analyze.corpus` | `corpus.update` | One book's text registered with the cross-book engine. |
| `analyze.publish` | `corpus.publish` | One whole snapshot produced. |
| `analyze.reference` | `corpus.reference` | The same, for books that are denominators rather than targets. |
| `analyze.project` | `analysis.pass` | One drain of the scheduler: refresh the dirty books, publish once. "Project" implied it was about opening one, which is only one of the times it runs. |
| `editor.sous` | *(gone)* | A field on the `editor.render` it causes: it fires once per open Book per Publication, on a forked fiber, and its cost IS the repaint. `findings.shown` counts them there. |
| `save` | `save` | Unchanged. `version.record` was proposed and rejected: `documentation/glossary.md` reserves Save/Recovery/Checkpoint and warns against collapsing them into "version". "Record a version…" is product copy for one Save. |
| `save.write` | `file.write` | The bytes hitting disk, which is a different fact from the Save succeeding — they can fail separately. |
| `save.adopt` | `baseline.adopt` | A baseline was taken. |
| `save.external` | `file.changed` | Something outside Sefer edited the file. |
| `save.resolve` | `conflict.resolve` | |
| `recovery.journal` | `journal.write` | |
| `recovery.compact` | `journal.compact` | |
| `recovery.pending` | `journal.pending` | |
| `recovery.restore` | `journal.restore` | |
| `recovery.discard` | `journal.discard` | |
| `recovery.reopen` | `journal.offer` | It offers recovered work to the reader; the reader decides. |
| `library.load` / `library.add` | `library.load` / `library.add` | Already `<thing>.<verb>`. Unchanged. |
| `project.instantiate` | `seat.open` | A book got an editor attached. |
| `project.release` | `seat.close` | |
| `project.metadata` | `project.metadata` | Unchanged — it is a thing, and it was read. |
| `editor.close` | `seat.close` | Same event as `project.release`; it was named twice. |
| `keystroke` | *(gone)* | Fields on the gesture. |
| `book.apply` | *(gone)* | Fields on the gesture. |

## One call per keystroke

Decided, and written here because the names encode it: **Galley is called once
per keystroke, and that call returns both the structure and the problems.**
Parsing and proofreading are one pass because the engine walks the text once.

`galley.parse` carries `galley.why` naming its caller, so a second call in one
keystroke is visible rather than theoretical. Measured on 2026-09-16 before the
fix: 144 parses for 18 keystrokes, of which 20 were the editor's.

## `op.cause`

Three ways one record relates to another:

- **child** — it happened *inside* this work. A file write inside a version
  record. Shown nested.
- **cause** — a *different* piece of work happened *because of* this one, later.
  A keystroke causes an analysis pass. Separate records; `op.cause` carries the
  originating gesture's trace id so one query returns the whole cascade.
- **neither** — it just happened. A watcher noticing a file changed.

Why cause and not parent: an analysis pass is debounced and serves several
keystrokes. A parent would have to pick one of them and be wrong about the rest,
and the gesture's own record would have to stay open across the debounce, so it
could never be written when the gesture finished.

```js
traces.recent({ where: { "op.cause": "<a keystroke's trace>" } })
// → editor.mutation, analysis.pass, corpus.publish, findings.shown
```

## Decided

- **Uniform plain verbs.** `book.analyze`, not `book.analyzed`. One past-tense
  name among forty imperative ones costs more than the ambiguity it avoids, and
  `book.apply` already proves nobody reads these as commands.
- **`save` stays `save`.** See the rename table.
- **`findings.shown` is a field, not an event.** On the `editor.render` its
  Publication causes.

## Canonical

`documentation/glossary.md` is the source of truth for every term here; this
file is the argument, not the record. Terms and the naming rules have been
folded into it.
