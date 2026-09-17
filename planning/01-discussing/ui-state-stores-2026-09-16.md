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

1. ~~`books` store, and move `unsaved`/`saveState` onto it.~~ DONE (61ca050),
   with the `ShellEvent` union. Not the loudest case — see above.
2. ~~`findings`, written on publication rather than on every edit.~~ DONE
   (d246dfb). This was the loudest case: 174.8ms -> 19.1ms of reactive work per
   ten keystrokes. `shell.findings`, `findingCounts`, the new `attentionOf` and
   `ProjectSidebar.rows` are off `tick`; `FindingsPanel`, `InventoryPanel` and
   `GlyphDetail` still read it and should follow.
3. `structure`, from the editor receipt. NEXT. Frees `LocationBar` (the
   chapter table), `ProjectSidebar` (the chapter grid) and `terms`.
4. `versions`, `conflicts`, `recovery` — lower traffic, mechanical. Frees
   `HistoryPanel` and `changes.ts`.
5. ~~`Toolbar.can`.~~ DONE (0e5ae41), and it needed no store. The predicate IS
   the dependency declaration; `can()` is now `findCommand(id)?.available()`
   called inside JSX. Eighteen of the twenty-three `when()` predicates already
   read only signals — the holdouts asked CodeMirror for undo/redo depth and
   the chapter count, which publish to nobody, so those two rode onto the
   `books` row. Verified in the app: Undo and Redo flip correctly with no
   counter.
6. Delete `tick` and `bump`.

## Open questions — settled 2026-09-16

**Command availability declares itself; it does not become a store.** Wrap
`available()` in a `createMemo` per command. Eighteen of the twenty-three
`when:` predicates already read only signals (`focused`, `project`, `seated`,
`mode`, `chapter`) and are free. The residue is two named inputs, both owned by
a store already planned: undo/redo depth (`commands.ts:410,419`) is CodeMirror
history, so it becomes a field on the `books` row written from the receipt —
the editor surface is the subscriber and already holds it; and `chapterCount`
(`:448,460`) lands with `structure` in step 3. No sixth store.

**`excerpts` and `inventory` are route-scoped, and `excerpts` is not state at
all.** `ui/excerpts/feed.ts` is shared machinery behind two routes — Find and
Key terms — that takes `hits` as an input and groups them into cards and an
outline. The hits are a search result or the STET guide's references mapped
onto the project. So "excerpts" is a shape, derived twice over, and there is no
single state to share: at most one of the two feeds is mounted, and they do not
agree on their source. `inventory` is one screen's census and its future is
undecided. Both stay route-scoped, subscribing to `findings` while mounted.

**A shell event union, and it landed with step 1.** Not the `Receipt` as-is:
several sources (editor receipt, `SaveReceipt`, recovery restore, external
change, seat swap) do not share a shape. The union is `src/app/shellEvent.ts`,
named by the glossary's `<thing>.<what happened to it>` rule, and narrow — a
variant carries what a store reads today and nothing more. It was worth landing
immediately rather than at step 4 because the variety was already present at
the twelve `bump()` call sites: each one already knew its books, and `bump()`
was the only thing throwing that away.

## What the measurement said — and what it corrected

Measured on `en_ulb` (66 books, sidebar open, editing 1KI), 10 keystrokes, over
CDP against the running app. The derived-recompute counter this document said
was missing already exists: the dev server exposes Solid's attribution bridge at
`/__solid/diagnostics` (`POST {"method":"begin"|"costs"|"end"}`), which reports
per-scope `runs`, `selfMs` and `wastedMs` by name. No instrumentation needed.

|                     | e5d77b9 | + `books` | + `findings` |
| ------------------- | ------- | --------- | ------------ |
| reactive self time  | 174.8ms | 162.7ms   | **19.1ms**   |
| wasted recomputes   | 78.3ms  | 68.4ms    | **0.8ms**    |
| `sidebarBooks` runs | 10      | 10        | **3**        |
| `sidebarBooks` self | 62.1ms  | 63.1ms    | **1.0ms**    |

**The migration order in this document was wrong.** Step 1 was called "the
loudest case" and it moved nothing: on the editor route nothing reads per-book
save state. The three `unsaved`/`saveState` callers are the project census page
and the book route, and the census page is not mounted while you type. The
per-keystroke fan-out `unsaved` causes is real, but it is a cost of the screen
that shows it, not of typing. Step 1 is still right — it removes the shape that
let a getter cost four parses, and it is what the rest hangs off — but it is not
where the time was.

The time was in step 2, and for a reason this document did not name:
`ProjectAnalysis.attach` invalidates the findings caches inside `book.changes`,
so they are dropped on **every accepted edit**, not once per scheduler pass.
`findings()` and `census()` each rebuild every finding in every book, and behind
`tick` the toolbar bell, the rail bell and the sixty-six sidebar rows each paid
that rebuild per keystroke — to redraw badges that could not have moved, because
the held analyses do not change between passes.

`galley.why=save.hash` per `editor.mutation` is already 0: no `galley.*` records
appear in the ring during typing at all. The revision-first check and the
memoised hasher fixed that before this plan started, which is why step 1 had no
number to move. `editor.js_ms` is unchanged at ~5.3ms throughout — it measures
CodeMirror's own gesture, which was never the problem.

## Migration

**Eight** `shell.tick()` reads remain, from twenty-two. Every one is blocked on
a store that does not exist yet:

| Reader | Wants |
| --- | --- |
| `LocationBar.tsx:58` | `structure` (step 3) |
| `ProjectSidebar.tsx:125` (chapter grid) | `structure` |
| `terms.tsx:162`, `:249` | `structure`, plus book text |
| `HistoryPanel.tsx:187` | `versions` (step 4) |
| `changes.ts:88`, `:128` | `versions` |
| `feed.ts:111` | book TEXT — see below |

(`settings.tsx:55` reads a LOCAL `settingsTick`, not the shell's. The audit
table above miscounted it; it is not part of this migration.)

### The one question step 3 will force

`feed.ts` and `terms` do not read a derived product — they read book **text**.
No store holds text, and putting it in one would mean holding the project's
whole corpus in a Solid store, which is the opposite of what the `books` row
does (it holds a STAMP so a reader can ask "has this moved?" and go read the
Book itself). The likely answer is that these readers take the stamp and
re-read the Book, exactly as `FindingsPanel.isStale` now does — but it is a
decision, not a mechanical port, and `structure` is what will force it.

## What opening /findings actually cost

Traced on the production build, against the real `en_ulb` imported into a
dedicated CDP profile (`documentation/agents/verification.md`):

|                      | before | after |
| -------------------- | ------ | ----- |
| longest blocking task | 69ms   | 35ms  |
| tasks over 50ms       | 1      | 0     |
| total window          | 110ms  | 101ms |

The total is the same work and was never going to move: the 69ms task had no
hot spot, just a long tail — the feed model at 13.7%, then Solid, the
virtualizer's first measure, `offsetWidth`, and a hundred smaller things. What
moved is the shape. The panel's header, counts and filters paint in one task
and the list follows in the next, so nothing crosses the 50ms line that makes
a task "long".

Two rounds of making the work CHEAPER — lazy projection, then one closure per
excerpt instead of three — cut real CPU and moved the wall clock by nothing.
That is the lesson worth keeping: on this screen the question was never how
much work there is, it was how much of it happens before the browser paints.

## The profile of the ~100ms, for whoever picks this up

Production build, real `en_ulb` (20,352 findings, 66 books), warm route, click
on the findings rail to the first card. Timings from the production build;
FUNCTION NAMES from a dev build of the same interaction, because production is
minified and the two agree on shape.

    +0ms    click
    +17ms   (gap — the router's async transition)
    +17ms   TASK 1, 40ms
    +59ms   TASK 2, 57ms
    ~100ms  first card on screen

    TASK 1                              TASK 2
      14.1ms  35%  findingsFeed memo      13.6ms  24%  solid untrack
       3.9ms  10%  excerptsOf              7.8ms  14%  solid read
       3.8ms   9%  garbage collector       5.9ms  10%  virtual getMeasurements
       2.3ms   6%  (program)               3.7ms   6%  findingsFeed row
       1.5ms   4%  verseAt                 2.4ms   4%  virtual memoizedFunction

Task 2 is the virtual list: Solid creating the nodes for the cards on screen,
and `virtual-core` measuring. That one is roughly the product.

**Task 1 is the open question.** It is the feed's model — and the model is
supposed to be behind the `body()` gate, which is why the gate was built. It
should be running in task 2, with the list that reads it. Nothing in
`FindingsPanel` obviously reads `feed.*` during the shell render: the only
`createEffect` reads `search().code`, `at()`/`step()` are keyboard handlers,
and `focused()`/`focusedAt()` are props of `<ExcerptList>`, which is inside the
gate. So something reads the model earlier than it looks, and finding it is
worth more than any further trimming.

Two candidates to check first:

  * `createFindingsFeed`'s own `hits` memo maps every finding to an
    `Occurrence` — twenty thousand objects, and 14ms is about right for it. If
    something reads `hits` (not `model`), the gate would never have covered it.
  * The rAF/timeout may fire during the router's async transition, before the
    panel has painted at all — in which case `body()` is already true when the
    panel mounts and the gate does nothing. The ~17ms gap before task 1 is the
    transition, and it is long enough for that to happen.

If the second is true the fix is to flip the gate on a paint that has actually
happened, not on a frame that may already have passed.

## Still outstanding

Loose ends found while doing this, none of them blocking:

- **`noteWritten` has no callers anywhere.** So `onDisk` is always empty and
  `saveState` can never return `"onDisk"` — the failed-commit state the save
  model documents by name is unreachable. Pre-existing; behaviour preserved.
- **Bulk paths are unverified.** A forty-book format and a save/record should
  coalesce to one publication through `changed()`, and the reasoning is in the
  code, but neither was exercised.
- **The card height estimate is now a proxy.** It measures from `span` (source
  length, discounted for markup) because reading `excerpt.text` would project
  every excerpt and undo the laziness. Wants a human eye on real scrolling.
- **`{ ...excerpt }` is a footgun.** Object-spreading an excerpt evaluates every
  lazy getter and projects the document. Nothing does it today and the type says
  so, but the old shape could not be misused this way.
- **`ReviewPanel.tsx` contains raw NUL bytes** — `${bookId}\0${unitId}` written
  as literal control characters. Deliberate, but `file` calls the source "data"
  and plain `grep` silently finds nothing in it. Escaping them as `\0` would
  cost nothing.
- **Production CAN be measured, and the answer changed the plan.** The earlier
  claim here — that `vite preview` uses a different host adapter and cannot open
  a project — was wrong. The web host always uses OPFS; `/sefer` IS the OPFS
  root. What broke was the ORIGIN: preview on another port gets its own empty
  OPFS. Serve the production build on the dev server's own port and the project
  is simply there:

      kill the dev server; pnpm serve --port 3000 --strictPort

  Measured that way, on en_ulb, click to result count:

      dev   cold 401ms (30 requests)   warm 204ms
      prod  cold 292ms ( 6 requests)   warm 210ms

  So the module waterfall is real but only affects the cold path, and the warm
  path is the SAME in both. Solid's dev bundle was not the cost — roughly 200ms
  of real work is, and this document's earlier "half of it is dev overhead" was
  a guess that the measurement disproves.
- **~80ms of O(all findings) work is left, and it IS worth removing.** Profiled
  on the production build, warm:

      49ms  the findings feed's model memo   (builds a row per finding)
      32ms  buildExcerpt                     (builds a shell per finding)

  of ~198ms total. Both walk every finding to render twenty cards, and both
  want the same treatment: `group()` returning a lazy per-book structure
  (`count`, `keyAt(i)`, `estimateAt(i)`, `excerptAt(i)`) so the eager pass
  collapses to the one grouping pass that genuinely cannot be skipped — you
  cannot size a scrollbar without knowing how many rows there are.

  `VirtualList` already supports this: a row is `{ key, item, estimate }` and
  `item` is only touched when the row renders. The estimate does not need the
  real span either; a per-book average would do, and the virtualizer refuses to
  compensate a first measurement precisely so an imperfect estimate cannot move
  the viewport.

  Find and Key terms sit on the same feed, so all three screens get it. This is
  the next piece of work, and unlike the note it replaces, there is now a
  production number to aim at.

## Measurement

The observability work is what found this and should be what proves it fixed.
Before/after on one keystroke, from the ring (`__sefer.observability.recent()`,
scoped to one page load, readable over CDP):

- `galley.why=save.hash` per `editor.mutation` — was ~4.5, should be ~0 for
  books that are not being typed in.
- Count of derived recomputes per keystroke — needs a span or a counter around
  each store read to be measurable at all, which is its own small task.
