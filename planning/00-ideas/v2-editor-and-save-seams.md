# Sefer v2: the heart — one editor state per book, what coordinates across books, where diagnostics go, and how Save works

Status: idea for discussion, 2026-09-07. Deepens two sections of [the module seams](v2-module-seams.md): Editor (§3.4–3.6) and Save/Recovery (§4.1–4.2), plus the two questions the seams doc left implicit — how a single book's editor state relates to everything that coordinates across many books, and where engine diagnostics flow. Pseudo-TypeScript. Authorizes nothing.

---

## 1. One book, one canonical state; everything else is a reader

### 1.1 The four states a Book can be in

```text
Unloaded      path known, nothing read                               Project.books after discovery
Plain         Source in memory (text + stamp), no editor            census, project analysis, search, multi-book ops
Instantiated  a CodeMirror EditorState is the canonical text        the book the user is editing (usually one, at most a few)
Mounted       an EditorView is bound to the instantiated state      what the user sees
```

Transitions: `Unloaded → Plain` on first read (`openBook`); `Plain → Instantiated` when the user opens the book in the editor (the CodeMirror state is created FROM the plain Source and takes over as canonical; the plain Source becomes a derived view of it); `Instantiated → Mounted` when a view binds; `Mounted → Instantiated` when the view unbinds (the state and its history survive; nothing is lost when a tab closes); `Instantiated → Plain` only when the book is closed and its state released.

Invariant: **at any moment a Book has exactly one canonical text**, held either by the plain Source or by the instantiated CodeMirror state, never both. `book.source()` reads whichever is canonical. Nothing else holds a copy that can be edited.

### 1.2 The Book is the seat; readers subscribe

```ts
interface Book {                                  // the port both implementations satisfy (exists as the plain one)
  id; path
  source(): Source                                // canonical text + stamp, from whichever seat holds it
  apply(changes, origin, trust?): Result<Receipt, Refusal>    // THE one write path; synchronous
  changes(fn: (receipt, changes) => void): unsubscribe        // synchronous fan-out, in subscription order, after acceptance
  history(): { undo(); redo(); depth() }          // CodeMirror history when instantiated; none when plain
}

// Plain implementation (exists): apply = Source.apply, no phases, no history.
// Editor-backed implementation (editor area): apply builds a transaction, runs the PHASES (admission, normalization,
// protection, settlement), and if accepted updates the state — or the bound view, which is the same thing — then publishes.
```

Publication is **synchronous and explicit**, not a bus:

- `apply` returns after every subscriber has run. Subscribers run in subscription order over a snapshot of the set, so a subscriber may unsubscribe itself safely.
- A subscriber never mutates the Book inside the callback; it may schedule work (a Solid signal write, an Effect fiber) that runs after publication.
- There is no PubSub, no topic bus, no async queue between a Book and its readers. Effect `Stream` appears only in durable modules that are asynchronous by nature (external changes from disk, remote progress).

Why synchronous: the interaction budget. The keystroke path is `phases → analyze → mutate → publish` and must finish inside the frame with proofreading included. An async hop between the canonical state and the things that render it would add a frame and a source of reordering.

### 1.3 What sits on top, and how each reads

| reader | subscribes to | does on publish | writes back via |
|---|---|---|---|
| the bound `EditorView` | the state itself (CodeMirror update) | renders visible ranges | `view.dispatch` → the same phases → `apply` |
| a `ClipWindow` (result card, editable satellite) | `book.changes` | applies the same `changes` to its clamped state; keeps its own caret | `window.submit(changes)` → `book.apply(…, 'window')` → publish returns the change to every window including the sender |
| a read-only surface | `book.changes` | re-renders its range | never |
| `ProjectAnalysis` | every `book.changes` in the project | marks the book's analysis stale; re-analyzes off the keystroke path for books that are not the instantiated one | never |
| Findings panel | `ProjectAnalysis.watch` + the instantiated book's synchronous analysis | refreshes stamped findings | `Fixes.apply` → `apply(…, 'fix', trusted)` |
| Search results | `book.changes` for books with visible hits | marks hits stale (`resolveHit` returns null when the stamp moved) | `replace` → `apply` |
| `SaveCoordinator` | `book.changes` | marks dirty; schedules autosave; journals to Recovery | never edits; writes bytes |
| `MultiBook` | receipts it collected | tracks expiry of the immediate undo | `apply(…, 'project.<label>', trusted)` per book |
| Solid UI | a signal derived from `book.changes` | re-renders the pieces that show revision, dirty state, counts | commands → `apply` |

The rule that keeps this honest: **a reader never becomes a second writer with its own copy**. A window forwards; it does not merge. A fix previews against a stamp and submits through the funnel; it does not patch text. Recovery replays through `apply`; it does not write the project file.

### 1.4 Windows borrow, they do not recompute

A window's state has the same text as the canonical after publish. Its structure field asks the `borrowedStructure` facet first and takes the canonical `Analysis`/structure when `describesExactly(analysis, text)` holds, so ten open result cards cost zero extra analyzes (exists: `src/host/project.ts` in the spike, `borrowedStructure` in the spike's `docStructure.ts`). Between a window's submit and the canonical's answer, the window's text differs for one turn and it analyzes locally; that is the only time a window pays.

### 1.5 Coordinating across many books

`Project` owns Books and their lifetimes. Nothing above Project holds Books; it hands out references and closes them.

```ts
interface Project {
  books: Book[]; book(id): Book | undefined
  instantiate(id): Effect<Book>                   // Plain → Instantiated; creates the CodeMirror state from the Source
  release(id): Effect<void>                       // Instantiated → Plain; only when no view and no window is attached
  externalChanges(): Stream<ExternalChange>       // from FileSystem.watch, filtered to book files, debounced
  close(): Effect<void>
}
```

Cross-book operations are coordinated, not merged:

```ts
MultiBook.runAcrossBooks(label, plan):            // exists in the spike's recipe
  for each book: changes = plan(book); if (changes) book.apply(changes, `project.${label}`, trusted)   // one history event per book
  record { op, seen: Map<bookId, book.edits()> }  // the immediate Undo expires when any affected book edits again
```

`ProjectAnalysis` is the only module that holds many books' analyses at once, and it holds them as stamped, disposable products: `analyze(project)` fills a `Map<BookId, Analysis @stamp>`; a publish on a book marks that entry stale; the next reader triggers re-analysis. For the instantiated book the editor's own synchronous analysis IS the entry; ProjectAnalysis does not analyze it twice.

Solid integration, stated once: the UI boundary turns `book.changes` into a signal (`createSignal(book.source().stamp)` written from the subscription, cleaned up `onCleanup`). Components read signals; they never subscribe to Books directly. That is the whole of the "pub/sub" answer: synchronous callbacks at the domain seam, signals at the view seam, Effect Streams only where the world is asynchronous.

---

## 2. Where diagnostics go — sinks

Galley produces diagnostics in the same call that produces structure (one `WANTS`, always). From there:

```text
Galley.analyze(text)  →  Analysis { diagnostics[] }        one per text; on the keystroke path for the instantiated book
        │
        ├─ Sink 1  editor inline           synchronous, per keystroke: underline + gutter marks from the CURRENT state's analysis
        ├─ Sink 2  Findings (per book)     Finding[] @stamp built from analysis; panel, navigation, fix previews
        ├─ Sink 3  ProjectAnalysis         counts per book + crossBook findings; refreshed off the keystroke path
        ├─ Sink 4  Observability           COUNTS ONLY: note('analyze', 'ready', 'diag=N err=E', bookId) — never messages
        └─ Sink 5  Fixes                   a diagnostic with a fix reference becomes a FixPreview @stamp on demand
```

Rules for every sink:

- **Freshness.** Each sink carries the stamp (and engine hash) of the analysis it read. Inline marks are rebuilt from the current state every keystroke, so they cannot be stale. Panel findings and fix previews check `stale(finding, book)` before navigating or applying.
- **Budget.** Sink 1 runs synchronously by design: a wrong letter shows on the keystroke that typed it. Sinks 2–5 for OTHER books run off the keystroke path, triggered by publish, debounced when a bulk operation touches many books.
- **No message text in telemetry.** Observability records counts and codes, bounded; the messages live in Findings and the editor. The ring caps text at 512 chars regardless.
- **One shape.** Whatever the engine emits, Findings normalises to `{ id, bookId, severity, code, message, from, to, fix? }` @stamp. Cross-book findings from ProjectAnalysis use the same shape with a project-level id.
- **Positions are engine positions in the stamped text.** Findings never re-derive positions from text; if the stamp moved, the finding is stale and is recomputed, not shifted.

The editor module that turns `Analysis.diagnostics` into CodeMirror decorations is small and lives in the editor area (spike: `recipes/lint.ts` reading `structureAt(state).analysis`). It reads the paint index, not the decorations, to decide whether a diagnostic sits in hidden markup.

---

## 3. Editor, per function

Grouped by module, in dependency order. Every function listed exists in the spike unless marked *proposed*; names are the spike's.

### 3.1 Reading the engine — `parser/port.ts`, `core/cst.ts`

```ts
startEngine(wasmBytes): Promise<void>                        // once; the Galley Layer's load
runAnalyze(text, WANTS): Analysis                            // the one engine call; spans 'analyze'
describesExactly(analysis, text): boolean                    // docLen + full text; the fold's door
sameSource(a, b): boolean                                    // engine hash + length; parse-to-parse identity
scanCst(analysis): CstPlanes                                 // token planes (startAt/endAt/kindAt/markerAt/flags), line table from Newline tokens, node walk
shapeAt(i) / payloadEnd(i) / isBlank(i) / spellingAt(i)       // per-token facts read from the planes
```

### 3.2 The fold — `core/docStructure.ts` + `fold.ts`, `lineTable.ts`, `blockTable.ts`, `notes.ts`, `designators.ts`

```ts
buildStructure(doc, analysis, clip?): DocStructure           // typed-array tables; rows are lazy
LineTable:  length | at(n) | maybe(n) | fromAt(i) | toAt(i) | indexAt(pos) | contentFromAt(i) | clsAt(i)
BlockTable: length | at(i) | fromAt(i) | toAt(i) | contentFromAt(i) | clsAt(i) | headAt(i)
Line:  from | to | contentFrom | marker | cls | num | numTo | slot | notes | words          // lazy per row
Block: from | to | contentFrom | cls | head | startsLine
structureField: StateField<DocStructure>                     // memo by Text instance, then by exact source; borrowedStructure facet first
structureAt(state) / lineIndexAt(s, pos) / blockAt(s, pos)
```

### 3.3 Classification — `core/mapping.ts`

```ts
TOKEN_ROWS / NODE_ROWS: Row[]                                // one projection-free table; first match wins; bucketed by kind
rowForToken(kind, marker, flags): Row
rowForNode(shape): Row                                       // memoized on a packed shape key
isOriginReference(marker): boolean                           // spec vocabulary
unmapped(shape, why): Row                                    // named rows for malformed shapes awaiting a ruling
```

### 3.4 Policy — `core/registry.ts`

```ts
PROJECTIONS: Record<name, Assignment>                        // usfm | visual | note-satellite | hide-notes | hide-chunks | lock-structure
cellAt(state, cls): Cell                                     // { paint, mutability }
ownershipAt(state, cls): 'JOIN' | 'REFUSE' | 'DISSOLVE' | null
ownershipOf(row) / setsPaintedBy(cls) / paintsItsOwnLineAmbient(cls)
widgetFor(cls): 'versePip' | 'join' | 'joinSigil' | null
assignment: Facet<AssignmentDelta>                           // a mode selects presentation only
```

### 3.5 The plan — `core/plan.ts`

```ts
resolvePlan(structure, assignment): DocPlan
DocPlan.line(n): ResolvedLine      // slot, chunk, marks, reflow spans, paints
DocPlan.block(i): ResolvedBlock    // startsLine, breakAt, paints, reflow
DocPlan.verse(k): ResolvedSlot     // form: digits | box | pip | elided; digits, delimiter, hidden
DocPlan.notes / DocPlan.words      // lazy arrays
DocPlan.targets(): OwnedIndex      // lazy; see 3.6
DocPlan.joinWidget / docLen / revision
planAt(state): DocPlan             // cached per state; asserts revision equals the structure's
```

### 3.6 Owned targets — `core/owned.ts`

```ts
buildOwnedIndex(structure, plan, assignment): OwnedIndex     // builds nothing eagerly
rowAt(i): ResolvedOwnedTarget[]                              // targets whose element sits on line i; memoized
nearAt(i): targets for lines i-1..i+1
addressedBackward(pos) / addressedForward(pos): Addressed    // { target, kind: glyph|break|box|none, at }
targetAt(pos, direction): ResolvedOwnedTarget | null
targetsIn(from, to): { widened, hits: { target, whole }[] }  // bounded widening rounds over the lines touched
ofPainted(p) / ofWhole(p) / ofBox(p, atCaret) / ofHead(p) / ofHeadAhead(p) / hides(p)   // local pickers
illegalTarget(t): string | null                              // the lawfulness sweep's oracle
```

### 3.7 Paint and stops — `core/paint.ts`, `core/stops.ts`

```ts
paintOver(structure, plan): Paint                            // hidden(from,to) | draws(pos) | joined(pos) | atomic(state, line)
paintAt(state): Paint                                        // cached per state
stopsIn(state, structure, paint): Stops
Stops.isStop(pos): boolean                                   // C1 stated once
Stops.settle(pos, 'forward' | 'backward' | 'nearest'): number
Stops.next(pos, back?) / held(pos) / pass(pos)
inDesignatorDelimiter(structure, pos): boolean              // binary search over the verse table (exceptions.ts)
```

### 3.8 Rules — `core/phases.ts`, `compose.ts`, `sealed.ts`, `input.ts`, `deletion.ts`, `caret.ts`, `clip.ts`

```ts
PHASES: [{ phase, name, rule }]                              // admission → normalization → protection → settlement
install(rules, parser, omit): Extension                      // the only place changeFilter/transactionFilter and .reverse() live

// admission
refuseEditsOutsideTheClip(editableClipAt): ChangeRule
refuseKeystrokesInsideHiddenMarkup(structureAt, planAt, paint): ChangeRule
// normalization
supplyTheDelimiterAMarkerIsMissing(structureAt): TransactionRule
refuseATypedBackslash(): TransactionRule
refusePastesThatWouldAddAChapter(structureAt, chapterCount): TransactionRule
refuseMarkupPastedInsideAWord(structureAt, marksUp): TransactionRule
keepPoetryMarkersAtTheStartOfTheirLine(structureAt): TransactionRule   // binary search over blocks the change touched
// protection
deleteMarkersWholeOrNotAtAll(structureAt, planAt): TransactionRule     // rangePlan → rangeVerdict → rewrite | refuse | writeAround
rangePlan(ix, s, from, to): RangePlan                                  // detect on the widened range, consent on the original
rangeVerdict(plan, asked, pasted, joinText): RangeAct                  // pure
// settlement
settleTheCaretOnALegalPosition(structureAt, paint): TransactionRule
pullSelectionsIntoTheClip(caretClipAt): TransactionRule
```

### 3.9 Commands — `core/deletion.ts`, `core/input.ts`, `core/caret.ts`

```ts
backspaceAt(ix, pos): Verdict                                // dispatcher over target data
deleteAt(ix, pos): Verdict
CELL_RULES / cellRuleFor(t) / cellVerdict(t)                 // immortal → empty → sealed → no-merge → ordinary; first match wins
commit(state, s, paint, at, back, verdict, dispatch): boolean   // one shell for both keys; emits the verdict note
weld(s, state, from, to): string                             // the delimiter house move
consumePress / immortalGuard                                 // D9 write-around
guardedEnter(structureAt, plansAt): StateCommand
whereALineBreakMayLand(ix, …): Landing                       // box-travels (C3b), eject, plain
guardedBackspace / guardedDelete (Ctrl-h / Ctrl-d bound too) / mergeParagraphBackwards
moveCaret / extendCaret / caretLineBoundary / moveCaretByWord   // all consume Stops
usfmKeys(): KeyBinding[]
```

### 3.10 Rendering — `core/decorations.ts`, `core/render.ts`, `core/editorState.ts`

```ts
buildRegular(doc, structure, plan, { window, range }): BuildResult   // window = chapter clip (hides); range = work limit
WIDGETS: Record<WidgetKey, factory>
decoField: StateField<Built>                                  // decorations, atomic, isolates, stats
renderRangeField / setRenderRange / renderWindow: ViewPlugin  // visible ranges widened by RENDER_MARGIN; hysteresis
usfmEditor(options) / usfmEditorHeadless(options) / viewLayer(options)
```

### 3.11 Instruments — `core/meter.ts`, `core/timing.ts`, `core/trace.ts`, `core/inspect.ts`

```ts
keystrokeMeter(sink): { extension; open }                    // gesture opens at the DOM event, closes after the last update
span(name, note?) / openGesture / closeGesture / armed()
note(state, step) / noteTr(tr, step) / traceSink: Facet       // rule, verdict, detail; no-op without a sink
inspect(state, …): CaretInfo                                 // the demo explainer; read-only
```

### 3.12 Recipes over the editor — `recipes/*`

```ts
mountSatellite({ host: Funnel, range, editable, trust, extensions }): Satellite
collapseOutside(range) / satelliteRange(state)
findings(state): Finding[]                                   // from structureAt(state).analysis.diagnostics
copyAsUsfm / copyAsText(state, range)
attrs(state, at): Attr[]
```

---

## 4. Save and Recovery, per function

### 4.1 SaveCoordinator (slice 10)

```ts
SaveCoordinatorLive: Layer<SaveCoordinator, never, FileSystem | Observability | HostInfo>

save(book): Effect<SaveReceipt, SaveError>
  // 1  stamp = book.source().stamp; text = book.source().text          capture once; the receipt names THIS text
  // 2  bytes = Source.encode(text)                                      canonical LF out (serialisation style: slice 10 decides)
  // 3  serialize(book.path)( writeFileAtomic(fs, path, bytes) )         per-path queue; atomic on every host
  // 4  receipt = { bookId, stamp, hash: engineHashOf(text)?, bytes.length, at }
  // 5  baselines.set(bookId, { stamp, hash, text, savedAt })            the Baseline Diff consumes
  // 6  note('save', 'rewrote', `${id} r${stamp.revision} ${bytes.length}B`, id)
  // 7  Recovery.compact(bookId)                                          the journal up to this stamp is obsolete
  // failures: PermissionDenied | DiskFull | Conflict(onDisk differs from baseline) | Refused(dirty external change unresolved)

baseline(book): Option<Baseline>
dirty(book): boolean                                        // source().stamp.revision !== baseline.stamp.revision
autosave(book, policy: { idleMs; maxIntervalMs }): Effect<void, never, Scope>   // debounced on book.changes; never inside apply
externalChanges(project): Stream<ExternalChange>            // FileSystem.watch → stat/hash vs baseline → { bookId; kind: 'changed' | 'removed' }
resolve(change, choice: 'keepMine' | 'takeDisk' | 'compare'): Effect<void>
  // keepMine: next save overwrites (Conflict cleared explicitly); takeDisk: re-read → apply as one 'revert' receipt through the funnel
  // compare: opens Diff against the on-disk bytes as a Baseline-shaped value
serialize(path): <A>(effect: Effect<A>) => Effect<A>        // one queue per path; Save is the only owner of write ordering
saveAll(project): Effect<SaveReceipt[]>                     // MultiBook-shaped; one receipt per dirty book
```

Seam notes: Save reads `Book`, never CodeMirror. On Tauri and Web the code is identical over the `FileSystem` port; only the Layer differs. A same-length replacement can never pass as saved: `dirty` compares revisions within the session and the engine hash across sessions. Git's `commit(receipts)` takes SaveReceipts, so nothing is committed that was not written.

### 4.2 Recovery (slice 11)

```ts
RecoveryLive: Layer<Recovery, never, FileSystem | HostInfo | Observability>

journal(book, receipt, changes): Effect<void>               // append one line per accepted apply; under paths().appData/<projectId>/<bookId>.jsonl
  // debounced write, never on the keystroke path; the line carries { before, after, changes, origin, at }
pending(): Effect<Restorable[]>                             // on boot: journals whose last stamp is newer than the saved baseline
restore(id, project): Effect<Book>                          // open the saved text, replay the journal through apply(…, 'recovery', trusted); one history event
discard(id): Effect<void>
compact(bookId): Effect<void>                               // after a successful save: drop entries at or before the saved revision
```

Seam notes: the journal is per project and per book, outside the project folder, so Git never sees it and a shared drive never carries it. Replay goes through the funnel, so a journal from an older rule set is re-judged, not trusted. Recovery depends on Save's baseline to know what is pending; it never writes the project file itself.

### 4.3 The write path, end to end

```text
keystroke → phases → apply → publish ─┬─ view renders
                                      ├─ windows apply the same changes
                                      ├─ Save: dirty = true; autosave timer; Recovery.journal (debounced)
                                      └─ ProjectAnalysis: stale(bookId)
autosave fires / user saves → Save.save(book) → serialize(path) → writeFileAtomic → receipt → baseline → compact
Git.commit(receipts) later, explicitly
```

Two writers of bytes exist in the whole app, Save (project files) and Recovery (its own journal), and neither writes inside `apply`.

---

## 5. Open questions this document leaves for the owner

1. Which books are instantiated: only the one being edited, or a small LRU of recently edited books keeping their history? The model works either way; the memory budget decides.
2. Serialisation style on save: preserve the file's original newline style and BOM absence as read, or always write canonical LF. Slice 10 must decide; `Source` deliberately does not remember it.
3. Whether the editor's inline diagnostics (sink 1) and the Findings panel (sink 2) share one `Finding[]` per stamp or the inline path keeps reading raw diagnostics for speed. Recommendation: raw diagnostics inline, `Finding[]` for everything else.
4. Whether `ProjectAnalysis` for non-instantiated books runs in a Worker once the corpus is a whole project. The seam is unchanged either way; only the Layer's implementation moves.
