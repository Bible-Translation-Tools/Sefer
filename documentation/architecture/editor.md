# Editor

**The editor** is `src/editor/`: the CodeMirror area, and the `Book` implementation whose canonical text is a CodeMirror `EditorState`. It was ported property by property from the `onion-2-spike` prototype, which had a large Node and browser test suite behind it — behaviour there is the specification, and a difference from it is a bug here, not a design choice.

Nothing above the editor imports CodeMirror. The editor imports [Galley](galley.md)'s `Analysis` and core's `Book`/`Source` vocabulary, and nothing else from the application. Import from `src/editor` (the barrel).

## The analyzer facet

The spike called a module-level engine singleton. Sefer has none: the engine's lifetime belongs to the `Galley` Layer, and each Book gets its own memo. So the engine reaches a state through a facet — `analyzer`, in `core/analyzer.ts` — and `usfmEditor({ analyze })` / `usfmEditorHeadless({ analyze })` supply it. Composition passes `galley.memoize()`, one per Book, so a keystroke in Philemon does not evict the parse of Jude. `analyze` is **required**: the facet's own `combine` throws if it is missing, because a USFM editor with no engine is a text box wearing our class names.

Everything downstream is a function of that facet rather than of a global: `enginePort(analyze)` supplies the two questions the admission rules ask the engine (`marksUp`, `chapterCount`), and `structureField` reads `state.facet(analyzer)`.

## The editor-backed Book

`editorBook(plain, { analyze, extensions?, observability? })` is the Plain → Instantiated transition ([project](project.md), [source and book](source.md)). The state is created **from** `plain.source().text`, and from that moment the state _is_ the canonical text: `source()` derives the string from it, cached per `EditorState`, and the stamp's `revision` continues from the plain Book's and increments once per accepted doc-changing transaction.

`apply(changes, origin, trust?)` builds one transaction — `userEvent: input.<origin>`, `trusted` when the trust says so, `isolateHistory` for a `project.*` origin so a cross-book operation is one undo step per book — and runs it through the phases. Accepted: `Result.succeed(receipt)`. Refused (the doc did not change): `Result.fail(Refusal)`, whose `rule` names the phase rule when one recorded a refusal on the trace and `editor.phases` otherwise.

**The publication rule.** After the state has moved, and synchronously: borrowing surfaces first (`attach(receive)`, given CodeMirror's own `ChangeSet` so a window maps its caret through the exact same description), then the `Book` port's `changes(fn)` listeners with `(receipt, Change[])`. `apply` returns only after every subscriber has run. There is no bus and no queue — the keystroke path is `phases → analyze → mutate → publish` inside one frame.

A bound view MUST route its transactions through `book.fromView(view, trs)`; that is where a keystroke becomes a receipt. `apply` throws if a bound view accepted an edit without it, rather than report a receipt nobody heard.

`services.ts` builds the seat `openProject(root, { seat })` wants, one `editorBook` per book. `attached()` counts bound views plus `hold()`s (satellites) and is what makes `project.release` refuse.

## Satellites borrow

`mountSatellite({ host: Funnel, range, … })` gives a view over one range — Find's and Key terms' editable excerpts are satellites, and a virtualised one simply mounts over the latest canonical text when it scrolls into view. A satellite is a reader that may write, and it keeps the discipline: a local edit is turned into changes, submitted through the `Funnel` (`funnel.ts` — `doc`, `structure`, `submit`, `attach`, `undo`/`redo`/`depth`), and applied locally only when the canonical Book publishes it back. It keeps its own caret across the round trip; it never keeps its own text. `fromCanonical` marks the text coming home, so nothing resubmits it.

Structure is **borrowed**, not recomputed: a window's `structureField` asks the `borrowedStructure` facet first and takes the canonical `Analysis` when `describesExactly` holds, so ten result cards over one book cost zero extra parses. The one turn a window pays for a parse of its own is between its submit and the answer.

**History is the Book's, and a borrowing surface has none.** A satellite's `Mod-z` calls `funnel.undo()`, and the toolbar's button, the palette and the keymap all reach the same `EditorBook.history()` — so undo means one thing whichever surface has focus. The consequence to watch is that the command runs against the CANONICAL view: CodeMirror's history restores the selection that view held before the change and asks to scroll to it, which is right when the reader is in it and wrong when they are in a satellite. `withoutScrolling` (`core/scroll.ts`) refuses the scroll for the length of that one gesture, through CodeMirror's own `scrollHandler` facet, and only when the canonical view does not have focus. The edit lands and every surface hears it back through its `Funnel`; only the page is kept still. Pressing the toolbar's Undo while typing in a footnote used to throw the page from the apparatus at the foot of the chapter back up to the verse and destroy the note editor with the widget that held it.

## The phases

`admission → normalization → protection → settlement`, listed as data in `core/phases.ts`. Admission runs as a `changeFilter` (it can veto ranges before a transaction exists); the rest run as `transactionFilter`s, which CodeMirror runs last-registered-first — `compose.install` is the only place that knows, and it reverses so registration order is the order rules see. Every rule is named, so `omit` can turn one off and a trace can say which door a keystroke went through — see [Instrumentation](#instrumentation).

## Structured entry

Four insertions and one card. All of them build a `TransactionSpec` against the **current** selection and dispatch it through the ordinary kernel: admission may veto, normalization may straighten, settlement moves the caret onto a legal stop, and because each is one transaction each is one Undo step.

`core/insert.ts` holds the four; `core/actions.ts` names them so the shell can ask for one without importing CodeMirror, and `EditorBook.perform(action)` runs it against whichever seat is canonical — the bound view when there is one, the held state when there is not. That is the same door `undo`/`redo` go through.

| gesture            | key           | what it builds                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------ | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `insert.verse`     | `Mod-Shift-v` | `\v N ` at the caret with **N selected**, so the first keystroke replaces it. `N` is the highest verse already opened in this chapter at or before the caret, plus one (a `\v 1-2` range answers 3). A caret inside a word moves forward to the word's far edge first — an aligned `\w …\w*` wrapper counts as one word. A leading space is supplied when the caret is hard against a glyph. |
| `insert.paragraph` | `Mod-Shift-p` | at a block's content head, converts that block's marker to `\p`; anywhere else, splits the line: `\n\p ` at the caret.                                                                                                                                                                                                                                                                       |
| `insert.poetry`    | `Mod-Shift-l` | the same two shapes with `\q1`, and **by repeat**: pressed inside a `\q1` it writes `\q2`. `insertPoetry(structureAt, 1 \| 2)` takes the level as an argument instead.                                                                                                                                                                                                                       |
| `insert.footnote`  | `Mod-Shift-n` | `\f + \ft …\f*` with the selection as the body, caret at the end of the `\ft` content.                                                                                                                                                                                                                                                                                                       |

Two rulings worth knowing:

- **A footnote never swallows markup.** A selection in regular mode is measured in source offsets, and the source between two visible glyphs may be a paragraph break and an `\s5` the reader never saw — one Shift-Right at the end of a line crosses all of it. So a run that contains a newline or a backslash is **not** wrapped: the note is anchored at the selection's start and the text is left where it is. Refusing to guess is the answer [Search](search.md) gives to a hit that straddles markup, for the same reason.
- **Where the caret ends up is settlement's call.** In regular mode `note.markup` and `note.body` are elided, so a fresh footnote collapses to its caller as soon as it parses and the caret is pushed to the nearest legal stop beside it; editing the body is the note satellite's job. In USFM mode the caret stays inside the `\ft`.

Each chord is bound **twice**: in `usfmKeys()` (so a press with the editor focused reaches the caret with no round trip) and on the shell command of the same name (so the palette lists it and so it works when focus is elsewhere). They cannot both fire — `installCommandKeys` skips a chord the editor already consumed.

The footnote chord is `Mod-Shift-n`, for **n**ote. It used to be `Mod-Shift-f`, which is `search.open` — "find in project" — so one press meant two different things depending on where the focus was, and the editor silently won. Two commands that a reader thinks of separately do not share a chord.

### Footnotes: two halves of one note

In regular mode a note is drawn twice — as a superscript CALLER where it is
anchored, and as a ROW in the apparatus block at the foot of its chapter.
`src/editor/recipes/noteEditor.ts` is what makes both live; before it,
`toggleNote` was a stub nothing installed, so a caller was a letter you could
not follow and the rows were a picture of the notes rather than the notes.

Three gestures, and `NoteGesture` names them:

| Click                     | What happens                                               |
| ------------------------- | ---------------------------------------------------------- |
| a caller                  | the page goes to that note's row and tints it for a moment |
| a row's mark or reference | the page goes back to the caller                           |
| a row's body              | the body becomes editable in place                         |

The editable body is a **satellite** (`recipes/satellite.ts`) mounted into the
row's own `.usfm-note-edit` slot. It holds no copy of the text: every keystroke
becomes changes, goes through the `Funnel` to `book.apply`, and comes back from
the canonical Book. The row's static text hides while it is open
(`usfm-note-editing`) so the note is never on screen twice, and the row is
written back from the document when it closes — the widget refuses to patch a
row whose slot is occupied, and closing is not a decoration change, so nothing
else would.

Two rulings worth knowing:

- **Its range is the note's CONTENT, not the whole note.** The `\f +` opener,
  the caller sigil and the `\f*` closer are markup, and renaming `\ft` to
  `\fq` is a USFM-mode edit — the same ruling the front matter card makes about
  marker names. A note with no content parts at all — one the engine could not
  close, and every note the moment `Insert footnote` makes it — gets a
  ZERO-WIDTH window where its closer begins, which is where the body belongs.
  It used to get the whole note, whose end is past `\f*`: the reader's first
  keystroke in a fresh footnote landed outside the note, in the verse, and
  with no body part to aim at the caret defaulted to offset 0 and the letter
  appeared at the top of the book. The window is read LIVE from the
  satellite's own scope, so a zero-width one grows with the first character
  rather than hiding it.
- **The write is `trusted`.** In regular mode the entire note is hidden markup,
  so `refuseKeystrokesInsideHiddenMarkup` guards every offset in it; an
  untrusted satellite there is a text box that silently refuses every key. The
  surface is narrow and its targets are hard-edged, which is the trade that
  argument rests on.

Three more things the row has to get right, all of them learned the hard way:

- **An empty body wears a placeholder.** An empty inline span is zero pixels
  wide, so the one target in the row that means "let me write this" was
  unclickable on exactly the note a reader had just made. `paintNoteBody`
  writes "Add note text" into an empty body and marks it `usfm-note-empty`;
  the placeholder IS the click target, which is why it is a class and not a
  `::after` (the handler asks `closest(".usfm-note-body")`, and a
  pseudo-element has no node to close over).
- **`Insert footnote` opens the editor on the note it just made**, scrolling
  to the apparatus block first when the row is not drawn yet — a row is a
  widget and CodeMirror renders only what is on screen, so a note inserted
  half a chapter above its own row had nothing to mount into. The recipe
  notices the insertion by its `input.usfm.footnote` user event rather than
  having the command say so, which keeps the command headless.
- **A rebuilt row is a closed editor.** The apparatus block moves on every
  keystroke in the chapter and CodeMirror rebuilds the widget when it does,
  taking the mounted editor's parent element with it and leaving a view
  attached to nothing. A row that has left the document is treated as closed
  and the editor is mounted again on the new one, so the box survives.

The box itself is the size of its contents: it takes the rest of the apparatus
row, wraps, and grows the ROW rather than scrolling inside itself. It was a
fixed `inline-block` of `12ch` with CodeMirror's own scroller in it, which made
a note of two sentences a keyhole.

The satellite installs `structureField` and NOT the whole `readingLayer`:
`readingLayer` brings `decoField`, whose regular-mode projection is the one that
collapses a note to its caller, and inside this view that would hide the very
text the reader clicked to write in. `buildNoteApparatus` is the projection it
wears instead — markup elided, the origin as `usfm-fr`, the body as `usfm-ft`.

A clipped chapter still shows its own apparatus: the block is planned per
chapter and sits at the end of the chapter's last line, so it is inside the
clip's own window rather than outside it.

### The front matter card

`core/frontmatter.ts` replaces the header lines — `\id \ide \usfm \h \toc1-3 \toca1-3 \mt*`, stopping at the first line that is neither blank nor one of those — with **one block widget** of labelled fields, in regular mode only. It is the aligned-word popover's idea at book scale, and it keeps that popover's discipline: the marker name is a locked label, because a marker is spec vocabulary and turning `\h` into `\toc2` is a USFM-mode edit.

- A field writes exactly its own line's value span, `[contentFrom, to)`, as one change through the view — so it reaches `book.fromView`, publishes one receipt, and is one Undo step.
- The write is **`trusted`**. Front matter sits before the first `\c`, so while the reader is clipped to a chapter `refuseEditsOutsideTheClip` would refuse every card edit. Same argument as the front matter card's own design: a structured surface with hard-edged targets says so rather than being silently inert.
- The span is re-resolved from the current state at write time (by position in the row list), not taken from the offsets the widget was built with — between building the card and blurring a field, an edit elsewhere may have moved everything.
- The widget updates its inputs **in place** (`updateDOM`, skipping whichever field has focus) instead of being rebuilt, because a rebuild between "type" and "blur" would drop the caret out of the field in use. Writing happens on `change` (blur or Enter), not per keystroke; Escape restores the value and returns focus to the document.
- It is a block decoration computed from a facet, not a view plugin — CodeMirror does not allow block decorations from plugins — and it is mounted by `BookEditor`, not baked into the seat, so a headless state never pays for it.

`editor.frontmatter.edit` dispatches a `focusFrontMatter` effect; a small view plugin picks it up and focuses the first field.

## Diagnostics, sink 1

`recipes/lint.ts` turns `structureAt(state).analysis.diagnostics` into inline marks and gutter fix actions. Rebuilt from the current state every keystroke, so an inline mark cannot be stale. A finding whose whole span is inside hidden markup is dropped by default — that test reads the **paint index** (`PAINT_PORT.hidden`), not the decoration set. A fix carries the analysis's `EngineStamp` and is discarded if the document moved under it.

## Instrumentation

**One instrument for the whole pipeline.** `core/instrument.ts` opens one **trace** per transaction and records every stage that transaction flowed through, in order, with what each decided. The trace is keyed on the transaction's **start state**: a command reads that state, then the filters run against it, so a whole gesture — the keymap command, admission, normalization, protection, settlement, and the derivations in between — lands in one trace under one correlation id.

- `tracer` is a **Facet** (`Facet<Tracer, Tracer | null>`), not a module global, because a book and a window over it trace separately, and because a test wants a ring while the app wants Sefer's Observability. `tracing(state)` is the guard every call site uses: one facet read, and **nothing is allocated when the facet is null**.
- `Trace.stage(phase, name)` and `Trace.command(name)` open a **frame** and hand back its closer. `compose.install` opens a stage around each phase rule and closes it with the verdict; `compose.usfmKeys` opens a command frame around each keymap binding. A command's frame stays open across the dispatch it makes, so its stages nest inside it and the command's own line closes the group.
- **A rule's own `note`/`noteTr` becomes its frame's verdict.** That is why adopting the tracer changed no rule: `guardedBackspace` still says `delete one character`, `moveCaret` still says `→ 76 → 83 (stepped to 77, forward)`, and nothing is recorded twice. When a rule says nothing, the verdict comes from what it returned — `true`/`tr` is `passed`, `false` or an empty spec list is `refused`, anything else is `rewrote`, and a protected range list is `passed` with the count as detail.
- `makeTracer(emit)` is the **single** implementation; ordering, timing and the refusal slot live there once. Only emission is pluggable: `localTracer` keeps the refusal slot and emits nothing, `sinkTracer` (in `core/trace.ts`) feeds the flat `TraceSink` the test harness wants, `observabilityTracer` writes Sefer's ring.
- **Refusals.** The instrument keeps the FIRST stage that refused since `clearRefusal()`, and `editorBook.apply` reads it for `Refusal.rule`/`reason`. First, not last: a change filter that vetoes a range runs before the transaction rules that would have rewritten it, so the first door to close is the one that decided.

**Levels.** `observabilityTracer` reads `observability.level()` **once**, when the trace begins — a keystroke must not change policy halfway through.

| level           | what reaches Sefer's ring                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `off`           | nothing                                                                                                                            |
| `verdicts`      | ONE note per transaction, and only when a stage did not pass: the first such stage. A paragraph of ordinary typing writes nothing. |
| `spans` / `all` | a span per frame (`editor.phase.<name>`, `editor.command.<name>`, with ms) **and** a note per frame verdict, in pipeline order     |

Every event carries the correlation `<bookId>#<trace seq>`, so one keystroke's stages group together and pair with the `book.apply` note the same gesture produced. Detail is counts and positions, never document text.

**The derivation pipeline.** `core/timing.ts` holds the spans the keystroke meter attributes time with — `scan`, `index`, `decorate`, `paint`, `diagnostics-render`. They are inert (two `performance.now()` calls) unless the meter has opened a gesture. A span cannot see an `EditorState`, so `onDerived` calls back into the instrument and each closed span lands on whichever trace is open as a `derive` entry. Those entries do **not** cross into Sefer's ring: they run several times per keystroke, and the meter already reports their exclusive totals in one bounded note. `phase:*` and `keystroke` spans are skipped, because the stage frame and the meter already measured them.

**Reading a keystroke.** Set the level to `spans` (`__sefer.observability.setLevel("spans")` under the dev server) and read `__sefer.observability.traces.recent()` (or `logs.recent()` for loose events): each frame is an `editor.phase.<name>` or `editor.command.<name>` span plus its verdict note, in pipeline order, all under one `<bookId>#<seq>` correlation, followed by the meter's one note with the derivation totals. There is no separate editor surface on `globalThis`.

`core/meter.ts` (wall time from the DOM event to the last update of a gesture) rounds out the surface. None of it is Effect: it runs inside change and transaction filters thousands of times per typed paragraph, where a service lookup per rule is not free and there is no fiber to carry a context.

## What was not ported

- **`attrs`/`attrResolve`** — the aligned-word popover needs two engine free functions the pinned wasm handle does not export. The half-ported popover threw a `TODO(seam)` and nothing installed it, so it is parked: [parked code](../../planning/04-parked/parked.md).
- **`formatEdits`** — the engine's normalisation is a [Galley](galley.md) door now, but it is not the editor's: nothing in `src/editor` references it. `Fixes.formatBook` (`src/core/fixes/fixes.ts`) calls it and applies the edits as one `book.apply`; see [findings](findings.md).
- **`startEngine` / `runAnalyze`** — replaced by the `Galley` Layer and the analyzer facet.

## The file map, by responsibility

`cst.ts`'s typed arrays are a CACHE over the Galley reader, not a second reader: every value is read through `TokenRow`/`NodeRow`/`Tree`/`Toc`, so a wire change lands in scripture-kitchen's generated reader and reaches the editor as a type error, not a misread. What the planes add is the editor's own — line openings, note/origin/wrapper scope, block extents, designator roles, the `mapping.ts` rows. Two helpers are named so they cannot be mistaken for the reader's: `firstTokenFrom(pos)` (the first token starting at or after a position; `Tree.tokenAt` answers the one containing it and throws outside the document) and `isHorizontalSpace(i)` (a `Pad` token or a `Text` token flagged `TOKEN_BLANK`; `TokenView.isBlank()` is the flag alone).

| what                                  | where                                                                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| the engine seam                       | `core/analyzer.ts`                                                                                                                            |
| the fold (structure)                  | `core/docStructure.ts`, `cst.ts`, `fold.ts`, `lineTable.ts`, `blockTable.ts`, `notes.ts`, `designators.ts`                                    |
| classification, then policy           | `core/mapping.ts` → `core/registry.ts`                                                                                                        |
| the plan, owned targets, paint, stops | `core/plan.ts`, `owned.ts`, `paint.ts`, `stops.ts`, `exceptions.ts`, `scroll.ts`                                                              |
| rules and commands                    | `core/phases.ts`, `compose.ts`, `sealed.ts`, `clip.ts`, `input.ts`, `deletion.ts`, `caret.ts`, `kernel.ts`                                    |
| structured entry                      | `core/insert.ts`, `actions.ts`, `frontmatter.ts`                                                                                              |
| rendering                             | `core/decorations.ts`, `render.ts`, `editorState.ts`, `editor.css`                                                                            |
| instruments                           | `core/instrument.ts`, `meter.ts`, `timing.ts`, `trace.ts`, `../observability.ts`                                                              |
| the Book, the funnel, views           | `book.ts`, `funnel.ts`, `views.ts`                                                                                                            |
| recipes over the editor               | `recipes/lint.ts`, `lintHover.ts`, `satellite.ts`, `noteEditor.ts`, `emptyBlocks.ts`, `flash.ts`, `pairing.ts`, `reference.ts`, `whereAmI.ts` |
| test tools (not tests)                | `testing/harness.ts`, `testing/mount.ts`                                                                                                      |
