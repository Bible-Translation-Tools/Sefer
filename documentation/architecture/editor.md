# Editor

**The editor** is `src/editor/`: the CodeMirror area, and the `Book` implementation whose canonical text is a CodeMirror `EditorState`. It was ported property by property from the `onion-2-spike` prototype, which had a large Node and browser test suite behind it — behaviour there is the specification, and a difference from it is a bug here, not a design choice.

Nothing above the editor imports CodeMirror. The editor imports [Galley](galley.md)'s `Analysis` and core's `Book`/`Source` vocabulary, and nothing else from the application. Import from `src/editor` (the barrel).

## The analyzer facet

The spike called a module-level engine singleton. Sefer has none: the engine's lifetime belongs to the `Galley` Layer, and each Book gets its own memo. So the engine reaches a state through a facet — `analyzer`, in `core/analyzer.ts` — and `usfmEditor({ analyze })` / `usfmEditorHeadless({ analyze })` supply it. Composition passes `galley.memoize()`, one per Book, so a keystroke in Philemon does not evict the parse of Jude. `analyze` is **required**: the facet's own `combine` throws if it is missing, because a USFM editor with no engine is a text box wearing our class names.

Everything downstream is a function of that facet rather than of a global: `enginePort(analyze)` supplies the two questions the admission rules ask the engine (`marksUp`, `chapterCount`), and `structureField` reads `state.facet(analyzer)`.

## The editor-backed Book

`editorBook(plain, { analyze, extensions?, observability? })` is the Plain → Instantiated transition ([project](project.md), [source and book](source.md)). The state is created **from** `plain.source().text`, and from that moment the state _is_ the canonical text: `source()` derives the string from it, cached per `EditorState`, and the stamp's `revision` continues from the plain Book's and increments once per accepted doc-changing transaction.

`apply(changes, origin, trust?)` builds one transaction — `userEvent: input.<origin>`, the origin itself in its own annotation (which is what a receipt reads back), `trusted` when the trust says so, `isolateHistory` for a `project.*` origin so a cross-book operation is one undo step per book — and runs it through the phases. Accepted: `Result.succeed(receipt)`. Refused (the doc did not change): `Result.fail(Refusal)`, whose `rule` names the phase rule when one recorded a refusal on the trace and `editor.phases` otherwise. A satellite's edit comes through `applyFrom` instead, judged under the satellite's own terms ([Satellites borrow](#satellites-borrow)).

**The publication rule.** After the state has moved, and synchronously: borrowing surfaces first (`attach(receive)`, given CodeMirror's own `ChangeSet` so a satellite maps its caret through the exact same description), then the `Book` port's `changes(fn)` listeners with `(receipt, Change[])`. `apply` returns only after every subscriber has run. There is no bus and no queue — the keystroke path is `phases → analyze → mutate → publish` inside one frame.

A bound view MUST route its transactions through `book.fromView(view, trs)`; that is where a keystroke becomes a receipt. `apply` throws if a bound view accepted an edit without it, rather than report a receipt nobody heard.

`services.ts` builds the seat `openProject(root, { seat })` wants, one `editorBook` per book. `attached()` counts bound views plus `hold()`s (satellites) and is what makes `project.release` refuse. An excerpt takes its hold when it opens and releases it, with its receiver, when it closes — its mount effect RETURNS that cleanup, because an `onCleanup` inside a Solid 2 effect callback has no owner and never runs; until 2026-09-25 every excerpt ever opened stayed attached.

## Satellites borrow

`mountSatellite({ host: Funnel, range, … })` gives a view over one range — Find's and Key terms' editable excerpts and the footnote editor are satellites, and a virtualised one simply mounts over the latest canonical text when it scrolls into view. A satellite is a reader that may write, and it keeps the discipline: a local edit is turned into changes, submitted through the `Funnel` (`funnel.ts` — `doc`, `structure`, `submit`, `attach`, `undo`/`redo`/`depth`), and applied locally only when the canonical Book publishes it back. It keeps its own caret across the round trip; it never keeps its own text. `fromCanonical` marks the text coming home, so nothing resubmits it. A refused submit leaves the caret where it was.

**The Book judges a satellite's edit under the satellite's terms.** Every `submit` carries `SurfaceTerms`: the surface's assignment deltas (`Assignment.deltas`), its `modeFacet`, its live range, and the gesture's own `userEvent` (`input.type`, `input.paste`, `delete.backward`). `EditorBook.applyFrom(terms, changes, origin)` reconfigures the canonical state with those terms beside `judgeLayer` — the engine, the structure and the same `PHASES`, none of the reading layer — runs the edit through it once, and commits what the phases let through to the canonical seat with `filter: false`, then publishes as any edit. One judge, the same rules as the main editor, nothing trusted. It exists because the canonical projection is the wrong judge for a surface that shows something the page hides: in it a footnote's body is hidden markup, and `refuseKeystrokesInsideHiddenMarkup` refused every key typed into the note editor, which is why that editor used to be trusted and so skipped every rule. The reconfigure keeps the parse (same field, same text); what an edit costs extra is the plan and paint index under the surface's projection, about 0.3 ms a keystroke on the fixture. Rejected: judging in the satellite and handing the Book a trusted result — the same shortcut in another place.

Carrying the gesture matters on its own: several rules act on the kind of gesture — a typed backslash, a paste that would add a chapter, markup pasted inside a word — and a satellite's edit used to reach them as an anonymous `input.<origin>` change, so a `\c 9` pasted into an excerpt went in.

**The commit carries the gesture too, and the origin beside it.** `applyFrom` commits with the gesture's own `userEvent` (`input.type`, `delete.backward`) and the surface's origin (`find-excerpt`, `note:412`) in a separate annotation, which `originOf` reads back for the receipt. CodeMirror's history joins only `input.type`/`delete` events made within half a second of each other, and a satellite's commits used to be `input.<origin>`, which it never joins — so every character typed in an excerpt or a footnote was its own undo step. Now typing in a satellite undoes as it does in the book: a run of typing is one step (observed: "alpha beta" typed into a Find excerpt on Philemon 1:5 went in and came out in one Mod-z). An `apply` with no gesture is still `input.<origin>`, which nothing joins, and a `project.*` origin still sets `isolateHistory`.

**A satellite's range is an edit guard, not only a clip.** Both halves are installed by `mountSatellite`, so no surface can forget them, and both are `core/clip.ts`'s own two rules over the range. The change half is the Book's: `refuseEditsOutsideTheSurface`, the first admission rule, reads the `surfaceRange` facet (empty on the canonical state, set from the terms on the judging state) and drops whatever part of a change lies outside — the one place every way an edit can arrive passes: a key, a command that edits away from the caret, a drop, a paste, a programmatic dispatch. The selection half is the satellite's, because the caret is: `pullSelectionsIntoTheClip` over the range, so the caret never sits where typing would be refused and select-all selects the range. Neither is waived by trust (`{ trustWaives: false }`). Before this, a satellite's document was the whole book and only `clippedToScope` hid the rest: select all and Backspace in a Find excerpt on Philemon 1:5 deleted the whole book, 2,679 characters to the 158 the marker rules protected.

**A satellite settles like the book, and its range is the smaller document.** `mountSatellite` installs the canonical editor's own `settleTheCaretOnALegalPosition` over the satellite's state (its projection, its mode, the borrowed structure) and the book's motion keys (`motionKeys()` in `core/compose.ts`: arrows, Home/End, word jumps, Shift-extend), then the range: `pullSelectionsIntoTheClip` pulls the result in, and one more rule settles what the range cut, inward — an empty caret or a selection end the range left on hidden markup (the `\v 5 ` an excerpt's first line opens with, or a stop the book's settlement found outside the range, which is where Home on an excerpt's first row used to go) moves to the nearest stop inside. So select-all in an excerpt selects from the first visible verse number to the last visible character, and Home, End and a click behave as in the book. A local edit is not settled (it is never applied locally; its caret is settled when the text comes home). The one position the range holds that is not a stop is an empty footnote's body — between `\ft ` and `\f*`, both hidden — and the zero-width range pulls the caret back to it after settlement moves it, which is the same carve-out admission makes for it (below). Until 2026-09-25 a satellite had no settlement at all.

A satellite has no history (below), and it answers the browser's own undo — `beforeinput` `historyUndo`/`historyRedo`, which a Mod-z the Book declined falls through to, and which the Edit menu sends — with the Book's, as CodeMirror's `history()` does for the canonical view. Left to the browser, it replayed the contenteditable's DOM history as an edit.

Structure is **borrowed**, not recomputed: a satellite's `structureField` asks the `borrowedStructure` facet first and takes the canonical `Analysis` when `describesExactly` holds, so ten open excerpts over one book cost zero extra parses. The one turn a satellite pays for a parse of its own is between its submit and the answer.

### Three range rules

Each is named and each is its own contract; a visual clip is not an edit guard.

| rule                   | where                                                      | what it holds                                                                                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| the chapter clip       | `core/clip.ts` — `pickField`, `editableClipAt`             | the canonical editor's one chapter. Visible and editable DIFFER: the `\c` line shows but is not editable. A trusted edit (a fix, the front matter card) may write outside it; it is the editor's view choice.         |
| the satellite range    | `recipes/satellite.ts` `scope`; `surfaceRange` in the Book | the part of the book a satellite covers. Visible and guarded ALIKE, and never waived by trust. Maps through every edit, so an edit at its edge grows it.                                                              |
| an excerpt's line snap | `app/ui/excerpts/ExcerptEditor.tsx` `lineRange`            | a presentation choice: the excerpt's verse span widened to whole lines, because a block replacement CodeMirror will draw starts and ends at a line boundary. It chooses the satellite range; it is not a third guard. |

**History is the Book's, and a borrowing surface has none.** A satellite's `Mod-z` calls `funnel.undo()`, and the toolbar's button, the palette and the keymap all reach the same `EditorBook.history()` — so undo means one thing whichever surface has focus. The consequence to watch is that the command runs against the CANONICAL view: CodeMirror's history restores the selection that view held before the change and asks to scroll to it, which is right when the reader is in it and wrong when they are in a satellite. `withoutScrolling` (`core/scroll.ts`) refuses the scroll for the length of that one gesture, through CodeMirror's own `scrollHandler` facet, and only when the canonical view does not have focus. The edit lands and every surface hears it back through its `Funnel`; only the page is kept still. Pressing the toolbar's Undo while typing in a footnote used to throw the page from the apparatus at the foot of the chapter back up to the verse and destroy the note editor with the widget that held it.

## Standalone markers

A marker the project registered as the engine's `standalone` category — today only en_ulb's `\s5`, and only in a project whose texts contain it ([galley](galley.md#the-marker-table-setextensions); the policy is `LEGACY_MARKERS` in `src/app/legacyMarkers.ts`) — is the registry's **`standalone`** class: **paint `none`, mutability `immortal`**. It is not drawn and no key takes it. A range deletion is the immortal cell's rule (`deleteMarkersWholeOrNotAtAll`): one that cuts into it writes around it, and one that covers it whole takes it with the rest, as a selection across a `\c` does — so selecting from the middle of verse 1 to the middle of verse 2 across a `\s5` and pressing Backspace removes the `\s5` and the `\v 2` with the text (checked headless). USFM mode's projection makes it `point × direct` like every class: shown and edited as written.

The editor never names the marker. `mapping.ts` recognises the category off the engine's marker row — a milestone that takes no closer, which no spec milestone is (`\ts` and the rest close with `\*`), so it is exactly the template a registered standalone resolves to, the same test onion's own walker makes. Two rows: `standalone.line`, when the marker opens its line (the line's class, like a designator line), and `standalone` inside a line (a point mark beside milestones and optional breaks, hidden in place).

**The paragraph flows through it.** A standalone leaves its paragraph open in the engine, and the reading view keeps it open too: a blank line or a standalone alone on its line, met after text, is held, and at the next text line in the same block becomes ONE join at the newline right after the text, with everything after it hidden — `\v 9 …Jesus.`, a blank line, `\s5`, `\v 10 I am…` reads "Jesus. 10 I am…" in one paragraph (Philemon 1:8–20 on the fixture is one paragraph). A held gap that nothing follows in the block is hidden up to its last line's end and not that line's newline, which is the boundary with the next block. The join sits on the text's own newline so that the stop before it is the end of the text (where typing belongs, [the line-end rule](#the-line-end-rule)), never the end of a hidden `\s5` line, where a typed letter would make `\s5X`. The same rule fixed an older glitch: a blank line inside a paragraph used to glue the lines on either side together with no space.

It replaced the editor's own s5 code: a `chunk` class that was any unknown marker opening a line, drawn as a `·` (`ChunkWidget`, titled "\s5 chunk marker"), and the `hide-chunks` projection. With it gone, a marker the engine does not know is shown as written wherever it is, and the engine reports it — which is what a `\s5` typed into a project that never had one now does.

## The phases

`admission → normalization → protection → settlement`, listed as data in `core/phases.ts`. Admission runs as a `changeFilter` (it can veto ranges before a transaction exists); the rest run as `transactionFilter`s, which CodeMirror runs last-registered-first — `compose.install` is the only place that knows, and it reverses so registration order is the order rules see. Every rule is named, so `omit` can turn one off and a trace can say which door a keystroke went through — see [Instrumentation](#instrumentation).

The rules read their policy off the state: `rowAt(state, cls)` from the `assignment` facet (the registry plus a projection's deltas), `modeFacet`, and the paint index built from both. On a surface those three are one extension, `modeView(name, surface?)` (`views.ts`) — the assignment delta, the mode, and the `cm-mode-*` class (plus an optional surface class such as `cm-excerpt`), which must stay in step or a surface paints one way and is judged another. BookEditor, the reference pane, the excerpt editor and the note editor all install it. It is deliberately not the reading layer: what a surface decorates with is its own choice, and the note editor wears the `note-satellite` projection without `readingLayer`, whose regular projection collapses a note to its caller.

### The line-end rule

**The end of a line's visible text is the stop.** When what follows a line's last visible character up to the line break is hidden — a paragraph's end before a blank line and a `\s5`, a word wrapper's hidden attributes — the stop is right after that character, and no position between it and the break is one; settling from any of them, in any direction, lands there (`visibleEnd` in `core/stops.ts`). End, a click past the end and an arrow key all meet it: End and the click land on the visible end, and an arrow that wants the next line keeps stepping, because `moveCaret` steps until the settled position differs from where it started.

It exists so that settlement and admission agree about one position. `refuseKeystrokesInsideHiddenMarkup` guards each hidden run and lets an insertion through at its edge, and the visible end is the run's first edge; the positions settlement used to accept were one past it, strictly inside the run (`night.|\n\n\s5\n` in Psalm 1:2 was offset 417, and a click past the end 421), and there typing and Insert footnote were refused while the caret sat still. Observed after the fix, on the fixture: End and a click past the end of Psalm 1:2, 1:1 (before `\q`) and Philemon 1:2 (before `\p`) all land on the visible end (416, 320, 364); typing there writes `night.X`, `mockers.X`, `home:X`; Insert footnote writes `\f + \ft \f*` there and the note editor takes the typing. USFM mode is untouched: it has no settlement, and End there is the doc line's end.

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
- **The write is NOT trusted.** It is judged by the Book's own phases, like
  the main editor's, under the note editor's terms: the registry's
  `note-satellite` projection (`note.caller` and `note.body` at point ×
  direct — visible and directly editable — where the canonical projection
  freezes them, and the note's markup still frozen), regular mode, and the
  note's content as the range. So a typed backslash, a pasted `\c`, a Delete
  that would eat the `\f*` are refused here exactly as they would be anywhere
  else. It used to be trusted, because judged in the canonical projection the
  whole note is hidden markup and every key was refused — and trusted meant no
  rule applied at all. See [Satellites borrow](#satellites-borrow).
- **An empty note is written at one position.** A fresh note (`\f + \ft \f*`)
  has no body part, so the body's place sits between two hidden markers and
  `refuseKeystrokesInsideHiddenMarkup` would drop an insertion there. Its
  zero-width range is what says otherwise: a pure insertion at the one
  position of a zero-width surface range passes that rule, and nothing else
  does. After the first character there is a body and the ordinary rules
  apply.

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
text the reader clicked to write in. `buildNoteApparatus` is what it paints
with instead — markup elided, the origin as `usfm-fr`, the body as `usfm-ft` —
and `modeView("note-satellite", "cm-note")` is the projection its edits are
judged in. The two agree on what is visible; one draws it, the other is data
the Book's rules read.

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

- `tracer` is a **Facet** (`Facet<Tracer, Tracer | null>`), not a module global, because a book and a satellite over it trace separately, and because a test wants a ring while the app wants Sefer's Observability. `tracing(state)` is the guard every call site uses: one facet read, and **nothing is allocated when the facet is null**.
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

`core/meter.ts` (elapsed time from the DOM event to the last update that carried a transaction, split into the browser's half, CodeMirror's `dispatch`, the derivation spans and a remainder) rounds out the surface. None of it is Effect: it runs inside change and transaction filters thousands of times per typed paragraph, where a service lookup per rule is not free and there is no fiber to carry a context.

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
