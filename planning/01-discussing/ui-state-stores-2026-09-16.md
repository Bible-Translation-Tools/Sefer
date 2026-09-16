# The tick, and what should replace it

2026-09-16. Discussing. Prompted by the observability work: `save.hash` was
costing four whole engine parses per keystroke, behind a call that read like a
getter, and nothing in the code said so.

## What `tick` is

`makeShell` holds one signal (`ProjectContext.tsx:322`). `bump()` increments
it; every derived read in the tree calls `tick()` to subscribe. It exists to
honour a rule that is correct and should survive this plan:

> The Solid/Book boundary rule (editor-and-save §1.5): NOTHING in
> `ProjectContext` subscribes to `book.changes`. Only the editor surface does,
> and when it accepts a receipt it calls `bump()`.

One subscription per book, at the one place that already has to have one. The
alternative — every panel subscribing to every Book — is worse, and core owns
no signals by design (`pnpm boundaries` keeps Solid out of `src/core`), so
something has to bridge the two.

So the bridge is right. The granularity is wrong: `bump()` says *something
changed somewhere* and every derived read in the application recomputes.

## The audit

Every reader of `tick()`, what it derives, and whether it recomputes once per
change or once per call.

| Reader | Derives | Memoised | Recomputes |
|---|---|---|---|
| `ProjectContext.findings` (470) | `projectAnalysis.findings()` | no | per call |
| `ProjectContext.unsaved` (526) | `save.dirty(book)` | no | per call, per book |
| `ProjectContext.saveState` (547) | `unsaved` + `onDisk` set | no | per call, per book |
| `Toolbar.can` (109) | `findCommand(id).available()` | no | **per command, per render** |
| `ProjectSidebar.rows` (82) | book rows + per-book finding counts | `createMemo` | once per tick |
| `ProjectSidebar` (130) | second derived read | — | once per tick |
| `LocationBar.table` (58) | `focused().structure().chapters` | `createMemo` | once per tick |
| `HistoryPanel` (186) | key over `selected`/`versions`/HEAD | `createMemo` key | once per tick |
| `changes.recordedChanges` (88) | per-book diff against recorded texts | no | per call |
| `changes` (128) | second derived read | no | per call |
| `FindingsPanel.all` (157) | `Findings.list(...)` + pattern filter | no | per call |
| `FindingsPanel` (170) | filtered/counted view | no | per call |
| `excerpts/feed.model` (111) | excerpt groups + outline over book texts | `createMemo` | once per tick |
| `InventoryPanel` (106) | character inventory over the project | `createMemo` | once per tick |
| `GlyphDetail` (131, 153) | per-glyph sites | no | per call |
| `terms.tsx` (162, 246) | term rows against the project | no | per call |
| `project/$id/index.tsx` (71) | project page rows | no | per call |
| `project/$id/book/$book.tsx` (75) | book route state | no | per call |
| `settings.tsx` (55) | settings-derived view | no | per call |

Nineteen readers. Nine screens. One counter.

## Why it is wrong, specifically

**1. Fan-out.** A keystroke in RUT recomputes the inventory, the excerpt feed,
the findings list, the sidebar census, the chapter table and the toolbar's
availability checks — none of which the keystroke could have changed in a way
those readers care about, and most of which are not on screen.

**2. No granularity.** `tick` cannot say *what* happened. Recording a version,
accepting an edit, a findings republication and a seat swap are the same event
to every reader, so no reader can skip. The information exists at the source —
`accept()` returns a `Receipt` naming the book, the revisions and the origin —
and `bump()` throws all of it away.

**3. The cost is invisible at the call site.** This is the one that bit.

```ts
const unsaved = (book: Book): boolean => {
  tick();
  return Option.isSome(services.save.baseline(book)) && services.save.dirty(book);
};
```

`dirty` called `hasher(source.text)`, and the engine exposes no hash door, so
`sourceHash` only falls out of a whole parse. Measured, before the fix: ~4.5
full engine parses per keystroke, against the editor's 1. The comment above
the hasher read "The parse this costs is a per-save parse, never a
per-keystroke one." It had never been true.

Fixed for now by checking the revision first (a number, not a parse) and
memoising the hasher on the text — but the shape that allowed it is untouched.

## The model this should be

```
event → core does the work (pure) → push the result into stores → UI reads them
```

The subscription rule is unchanged: the editor surface is still the only thing
subscribed to a Book. What changes is what it does with the receipt. Instead of
`bump()`, it writes what it learned into the store the receipt is about, and
only the readers of that store recompute.

Core stays signal-free. The stores live in the shell and are written by the
same one subscriber that calls `bump()` today.

## Proposed stores

Draft for discussion — the point of writing it down is to argue about the list.

| Store | Shape | Written when | Read by |
|---|---|---|---|
| `books` | per book: `stamp`, `origin`, `saveState` | editor receipt, save receipt, recovery restore | sidebar, project page, status bar, toolbar |
| `findings` | snapshot + per-book counts | `projectAnalysis` publishes | findings panel, sidebar counts, editor underlines |
| `structure` | per book: chapters, TOC | editor receipt for that book | location bar, chapter picker |
| `versions` | HEAD, recorded texts, per-book changed | a version is recorded | history panel, changes panel |
| `conflicts` | per book: external change | save coordinator's watcher | review, banners |
| `recovery` | pending journals | recovery scan, discard, restore | recovery banner |
| `inventory` | character census | findings snapshot, not every edit | inventory screen only |
| `excerpts` | groups + outline for the current query | search runs, or the books in the result change | excerpt feed |

Two rules the table encodes:

- **Keyed by book where the change is per book.** A keystroke in RUT must not
  invalidate PSA's row.
- **Derived from the event, not recomputed from the world.** The editor knows
  the new stamp; it should write it, not signal "go look again."

A Solid **store** (not a signal) wherever the state is nested and partially
updated — `books`, `findings`, `versions` — so a reader of one book's row is
not woken by another book's. Plain signals for the flat ones.

Explicitly NOT lifted: hover, selection within a panel, open/closed disclosure,
scroll offsets, draft text in an input. Those stay in the component.

## Migration

Incremental — `tick` can survive alongside the stores until the last reader
leaves, so nothing has to land in one commit.

1. `books` store, and move `unsaved`/`saveState` onto it. Kills the
   per-keystroke fan-out for the dirty markers, the loudest case.
2. `findings`, written on publication rather than on every edit. Second loudest:
   the findings panel, the sidebar counts and the inventory all hang off it.
3. `structure`, from the editor receipt.
4. `versions`, `conflicts`, `recovery` — lower traffic, mechanical.
5. `Toolbar.can` — needs its own think: command availability is a predicate over
   whatever a command happens to read, so it may want an explicit dependency
   declaration rather than a store.
6. Delete `tick` and `bump`.

## Open questions

- Does command availability (`Toolbar.can`) become a store, or do commands
  declare what they depend on? It is the one reader whose input is not a
  fixed set.
- `excerpts` and `inventory` are expensive and screen-local. Do they belong in
  a shared store at all, or should they be route-scoped resources that
  recompute on entry and subscribe to `findings` only while mounted?
- Does the push model want the `Receipt` as-is, or a shell-level event type
  that a save receipt and an editor receipt both widen into?

## Measurement

The observability work is what found this and should be what proves it fixed.
Before/after on one keystroke, from the ring (`__sefer.observability.recent()`,
scoped to one page load, readable over CDP):

- `galley.why=save.hash` per `editor.mutation` — was ~4.5, should be ~0 for
  books that are not being typed in.
- Count of derived recomputes per keystroke — needs a span or a counter around
  each store read to be measurable at all, which is its own small task.
