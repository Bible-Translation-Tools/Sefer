# Sefer v2: module seams — the functions where modules meet

Status: idea for discussion, 2026-09-07. Companion to [the module DAG](v2-module-dag.md); the Editor and Save sections are deepened in [the editor and save seams](v2-editor-and-save-seams.md). Pseudo-TypeScript, not code: signatures and one-line intents for every high-level function each module needs, grouped by module, with the shared types that cross seams listed once. Authorizes nothing. Names are placeholders until the owning slice lands.

Conventions used below:

- `Layer` means an Effect service with a lifetime, asynchrony or a host capability. `pure` means synchronous code Effect programs call. `port` means an interface with more than one implementation.
- `@stamp` after a return type means the value carries the `SourceStamp` (and, when it came through Galley, the engine hash) of the text it was computed from, and consumers must check freshness before acting on it.
- `Result<A, E>` is Effect's synchronous result. `Effect<A, E, R>` is asynchronous or needs services `R`.
- Modules marked **exists** have code on `master` today; the signatures shown are the real ones. Everything else is proposed.

---

## 0. Shared types (the vocabulary of the seams)

```ts
// One book's canonical text at one moment. Core computes no hash; the engine does.
type SourceStamp  = { revision: number; length: number }
type Source       = { text: string; stamp: SourceStamp }
type Change       = { from: number; to: number; insert: string }        // UTF-16 offsets into canonical LF text

// What an operation did to a Book, in stamps. Refusals carry no receipt.
type Receipt      = { before: SourceStamp; after: SourceStamp; origin: string }

// Who asked. Trusted origins bypass the keyboard guards the way a fix-it does.
type Origin       = 'keyboard' | 'paste' | 'window' | 'fix' | 'format' | 'project.<label>' | 'recovery' | 'revert'
type Trust        = { trusted: false } | { trusted: true; by: string }

// Every decision a rule takes, in the shape the trace records.
type Verdict      = { act: 'nothing' | 'consume' | 'default' } | { act: 'cut'; from; to; caret; event; seal? }
type TraceVerdict = 'ready' | 'passed' | 'refused' | 'rewrote' | 'consumed' | 'declined' | 'failed'

// Galley's result for one text. Immutable; identity is sourceHash + length.
type Analysis     = { tree; tokens; toc; diagnostics; sourceHash: string; docLen: number; revision: number; engineMs: number }

// One thing a reader should look at. Position is in the text the stamp names.
type Finding      = { id; bookId; severity: 'error' | 'warning' | 'info'; code; message; from; to; fix?: FixRef } // @stamp
type Hit          = { bookId; from; len; ref; preview }                                                          // @stamp
type Baseline     = { bookId; stamp: SourceStamp; hash: string; text: string; savedAt: number }               // what Save last wrote
type BookId       = string   // the \id code, falling back to the file stem
type Ref          = { book: BookId; chapter: number; verse?: number }
```

Freshness rule, stated once: nothing computed from a text acts on a different text. Within one Book's lifetime the `revision` decides; across lifetimes and between products the engine hash on the analysis decides. Length alone never does.

---

## 1. Host capabilities · Layers, one implementation per host

### 1.1 HostInfo — **exists** (boot half)

```ts
kind(): 'web' | 'tauri'
build(): string                                  // git sha + mode, injected at build time
paths(): { appData; logs; cache; temp }          // proposed; Tauri app dirs, Web: OPFS-rooted names
locale(): string                                 // proposed; feeds Shell localization
capabilities(): { nativeDisk; nativeGit; fsWatch; dialogs; secureStore }   // proposed; what this host can do

boot(host, build): Effect<BootInfo, UnknownHost | MissingBuildIdentity>   // exists
```

### 1.2 FileSystem — **exists**; the port is `effect/FileSystem`

```ts
// The port (Effect's). Sefer adds no methods to it.
FileSystem: readFile | writeFile | readDirectory | stat | exists | remove | rename | copyFile | makeDirectory | makeTempDirectoryScoped | watch | glob …

// Implementations
NodeFileSystemLive                                   // tests and tooling only; forbidden in core policy code
MemoryFileSystemLive(seed?): Layer<FileSystem>       // core; seeds the fixture project
OpfsFileSystemLive: Layer<FileSystem>                // Web production
TauriFileSystemLive: Layer<FileSystem>               // proposed; adapter over the fs plugin's scoped permissions

// Helpers over ANY implementation (core)
writeFileAtomic(fs, path, bytes): Effect<void, PlatformError>     // temp sibling then rename; previous bytes survive failure
scopedTo(fs, root): FileSystem                                    // lexical confinement; not a security boundary
nodeFsView(fs, run): IsomorphicFs                                 // the Node-shaped fs isomorphic-git needs

// Acceptance for any new implementation
fileSystemContract(name, makeLayer)                               // 17 laws; run in the tier where the layer lives
```

Seam notes: Save is the only writer of book files; Recovery writes its own journal; Git implementations read and write through this same port on Web, and through Rust on desktop. Per-path write serialization is Save's job, not the filesystem's.

### 1.3 Observability — **exists**

```ts
span(name, note?): () => number                  // synchronous; exclusive and inclusive ms; near-free below 'spans'
note(rule, verdict, detail?, correlation?)       // synchronous; the verdict log every rule and command writes into
recent(limit?): Event[]
export(): string                                 // JSONL
level() / setLevel('off' | 'verdicts' | 'spans' | 'all')
dropped(): number                                // sink failures, counted, never rethrown

ObservabilityLive({ capacity, level, sink }): Layer<Observability>   // also routes Effect.log* and Effect.withSpan into the ring
hostSink(): Sink | undefined                     // Node stderr JSONL when asked; browser console in dev
Otlp toggle: dev only, VITE_SEFER_OTLP_URL       // Effect's exporter merged beside the ring
__sefer.observability / __sefer.state            // dev-only read surfaces
```

Seam notes: modules call `span`/`note` at operation boundaries; pure transformations carry no spans. Keystroke-path code never allocates a fiber to log.

### 1.4 Settings — proposed

```ts
register<S>(key, schema: Schema<S>, default: S)   // a module declares the preference it owns
get<S>(key): S
set<S>(key, value: S): Effect<void, PersistError>
changes(key): Stream<S>
SettingsLive: Layer<Settings, never, FileSystem | HostInfo>   // JSON file under paths().appData; schema-validated on read
```

### 1.5 Credentials — proposed

```ts
get(remote: string): Effect<Option<Credential>>
set(remote, credential): Effect<void>
clear(remote): Effect<void>
CredentialsLive: Layer<Credentials>               // Tauri: OS keychain; Web: session-only, never persisted to project files
```

### 1.6 Dialogs — proposed (not in the DAG yet; every open flow needs it)

```ts
pickFolder(title): Effect<Option<Path>>           // Tauri dialog plugin; Web: directory picker / OPFS project list
pickFiles(filters): Effect<Path[]>
confirm(message, options): Effect<boolean>
DialogsLive: Layer<Dialogs>
```

---

## 2. Engine · Galley (Scripture Kitchen WASM: Onion parser + Sous proofreading)

### 2.1 Galley — proposed, adapter over the pinned artifact

```ts
load(artifact: Manifest): Effect<Galley, EngineLoadError, Scope>       // scoped: the wasm instance lives with the app
accepts(manifest): Result<void, VersionMismatch>                        // wire format + revision acceptance
version(): { engine; formatVersion; revision }

analyze(text): Analysis                          // SYNCHRONOUS. One wants set, always structure + diagnostics
sameSource(a: Analysis, b: Analysis): boolean    // by engine hash + length
memoize(book): (text) => Analysis                // per-Book memo by text identity, then by hash; one analyze per gesture
attrs(analysis, nodeId): Attr[]                  // wrapper attributes read through the engine's export
spelling(analysis, tokenId, text): string
```

Seam notes: `analyze` is the only place USFM is parsed in the whole app. Everything else reads `Analysis`. The keystroke path calls `memoize(book)(text)` and stays synchronous.

### 2.2 ProjectAnalysis — proposed, Sefer's whole-project consumer of Galley

```ts
census(project): Effect<BookSummary[]>           // ids, paths, stamps, chapter/verse counts; loads plain Books, no editors
analyze(project): Effect<Map<BookId, Analysis @stamp>>
crossBook(project): Effect<Finding[] @stamp>     // checks that need more than one book (coverage, duplicate ids, missing books)
fresh(bookId, stamp): boolean                    // is the held analysis for this stamp
invalidate(bookId)
watch(project): Stream<{ bookId; stamp }>        // republishes as Books change or external changes arrive
ProjectAnalysisLive: Layer<ProjectAnalysis, never, Galley | FileSystem | Observability>
```

---

## 3. Core domain · synchronous

### 3.1 Source — **exists**

```ts
decode(bytes): Result<Source, SourceDecodeError>               // UTF-8; refuses BOM, invalid bytes, mixed newlines; canonical LF
encode(source): Uint8Array
apply(source, change): Result<Source, SourceChangeError>       // refuses out-of-range, split surrogate, carriage return
```

### 3.2 Book — **exists** (plain); the port

```ts
interface Book {
  id: BookId; path: string
  source(): Source
  apply(change, origin): Result<Receipt, SourceChangeError>    // synchronous; notes 'book.apply'; publishes in order
  changes(fn): unsubscribe
}
openBook(path): Effect<Book, PlatformError | SourceDecodeError, FileSystem>   // plain, in-memory over one read
makeBook(path, source, observability?): Book

// proposed additions
close(book)                                                    // releases subscriptions; Project owns lifetime
editorBackedBook(view): Book                                   // editor area; canonical text is the CodeMirror state's doc
```

### 3.3 Project — proposed; one folder of books

```ts
openProject(root): Effect<Project, ProjectError, FileSystem | Dialogs | Observability | Scope>
interface Project {
  id: ProjectId                                                // root path + metadata identification when present
  root: string
  books: Book[]; book(id): Book | undefined
  metadata(): Option<BurritoMetadata>                          // from Resources schemas when a burrito
  externalChanges(): Stream<{ bookId; onDisk: SourceStamp-like }>   // from FileSystem.watch, filtered to book files
  close(): Effect<void>
}
discoverBooks(fs, root): Effect<Path[]>                        // *.usfm and burrito ingredients; ordered canonically
```

### 3.4 Editor — the CodeMirror area; ported property by property from the spike

```ts
// mapping.ts — one projection-free classification table (exists in spike)
rowForToken(kind, marker, flags): Row
rowForNode(shape): Row

// registry.ts — Table 3 as data: class → cell per projection
PROJECTIONS: { usfm; visual; noteSatellite; hideNotes; hideChunks; lockStructure }
cellAt(state, cls): { paint: 'point' | 'boundary' | 'ambient' | 'none'; mutability: 'direct' | 'via-anchor' | 'trusted-only' | 'immortal' }
ownershipAt(state, cls): 'JOIN' | 'REFUSE' | 'DISSOLVE' | null
widgetFor(cls): WidgetKey | null

// plan.ts — the resolved document plan, lazy per row
resolvePlan(structure, assignment): DocPlan
DocPlan: line(n) | block(i) | verse(k) | atomic | targets() | joinWidget | docLen | revision

// owned.ts — per-line owned targets, resolved on demand (0.2 ms cold on Psalms)
addressedBackward(pos) / addressedForward(pos): { target; kind: 'glyph' | 'break' | 'box' | 'none'; at }
targetsIn(from, to): { widened; hits: { target; whole }[] }

// paint.ts — positional paint index
paintOver(structure, plan): { hidden(from, to); draws(pos); joined(pos); atomic }

// stops.ts — C1 stated once
stopsIn(state, structure, paint): { isStop(pos); settle(pos, 'forward' | 'backward' | 'nearest'); next; held; pass }

// dispatchers — pure functions over target data
backspaceAt(index, pos): Verdict
deleteAt(index, pos): Verdict
rangeVerdict(plan, asked, pasted, joinText): 'pass' | 'refuse' | 'writeAround' | 'rewrite'
cellVerdict(target): Verdict | null                            // the one statement of cell policy

// phases.ts + compose.ts — the rule order as data; one installer hides CodeMirror's reversal
PHASES: [{ phase: 'admission' | 'normalization' | 'protection' | 'settlement'; name; rule }]
install(rules, parser, omit): Extension

// editorState.ts / compose.ts — the assembled editor
usfmEditor(options): Extension[]                               // reading + rules + commands + view layers
usfmEditorHeadless(options): Extension[]                       // for windows and tests
viewLayer(options): Extension[]                                // drawSelection, atomic ranges, bidi isolates; no keymaps
planAt(state) / structureAt(state) / paintAt(state)
renderWindow: ViewPlugin                                       // decorations for visible ranges + margin only

// meter.ts — the keystroke instrument
keystrokeMeter(sink): { extension; open }                      // wall from DOM event to update; exclusive buckets
```

Seam notes: the editor imports Galley's `Analysis` and Source's types; nothing above it imports CodeMirror. It provides the editor-backed `Book`. Modes select presentation only; no rule branches on a projection name.

### 3.5 Funnel — transactions and undo (06); the port satellites and windows submit through

```ts
interface Funnel {
  doc(): string
  submit(changes: Change[], origin, trust?): Receipt | Refusal  // through the phases; one history event
  attach(fn): unsubscribe                                       // synchronous publication of accepted changes
  undo(): boolean; redo(): boolean; depth(): { undo; redo }
}
// Book (plain) and the editor-backed Book both satisfy it; history is CodeMirror's per book.
```

### 3.6 Views — source, visual, chapter, book (07)

```ts
projectionFor(mode): Assignment                                // usfm | visual …; presentation only
pickChapter(state, ordinal | null): Transaction                // the clip: hide everything outside; core clip
visibleClipAt(state) / editableClipAt(state) / caretClipAt(state)
collapseOutside(range): Extension                              // result cards
scrollTo(ref): Effect<void>
```

### 3.7 Findings (14)

```ts
fromAnalysis(bookId, analysis): Finding[] @stamp               // engine diagnostics → findings, one shape
list(project): Finding[] @stamp                                // per book + crossBook, grouped
stale(finding, book): boolean                                  // stamp moved since computed
navigate(finding): Effect<void>                                // opens the book, clips the chapter, places the caret
severityOf(code): Severity
```

### 3.8 Fixes and formatting (15)

```ts
preview(finding, book): Result<FixPreview @stamp, NoFix>       // engine-produced edits, shown before applying
apply(preview, funnel): Result<Receipt, Stale | Refused>       // refused if the stamp moved; submits trusted 'fix'
formatBook(book): FixPreview @stamp                            // Onion's normalisation as one preview
applyAll(previews): Operation                                  // one history event per book
```

### 3.9 Satellites — read-only surfaces and editable windows (16, 17)

```ts
openWindow(book, range, opts): ClipWindow | null               // clamped headless state over canonical content
ClipWindow: state | clip | submit(changes) | onChange(fn) | bindView(view) | fromView(view, trs) | close()
mountSatellite({ host: Funnel; range; editable; trust?; extensions }): Satellite   // note apparatus, source mirror
referenceViewer(resource, ref): ReadonlySurface                // library resources, never editable
disposeAll(book)
```

Seam notes: a window forwards changes to the canonical Book and waits for them to come back; it keeps its own caret across the round trip. Windows borrow the canonical structure by exact source match.

### 3.10 Search (18)

```ts
find(project, query, options): Hit[] @stamp                    // plain scan of canonical texts; results carry stamps
resolveHit(hit, project): { book; from; to } | null            // null when the book moved on
replace(hit, insert, funnel): Result<Receipt, Stale>           // one match at a time, through the funnel
replaceAll(hits): Operation                                    // MultiBook
```

### 3.11 MultiBook (28)

```ts
runAcrossBooks(label, plan: (book) => Change[] | null): Operation | null   // one isolated history event per book, trusted
pendingUndo(): Operation | null                                // expires when any affected book takes another edit
undoPending(): boolean
dismissPending()
```

### 3.12 Baseline and Diff (23)

```ts
Baseline: { bookId; stamp; hash; text; savedAt }               // a data contract Save produces; Diff consumes it
compare(book, baseline): Hunk[] @stamp
revert(hunk, funnel): Result<Receipt, Stale>                   // submits trusted 'revert'
```

---

## 4. Durable editing · Effect

### 4.1 SaveCoordinator (10)

```ts
save(book): Effect<SaveReceipt, SaveError, FileSystem | Observability>   // atomic write; receipt = { stamp; hash; bytes; at }
baseline(book): Option<Baseline>
autosave(book, policy): Effect<void, never, Scope>             // debounced; off the keystroke path
externalChanges(project): Stream<ExternalChange>               // disk changed under us; surfaced, never auto-merged
resolve(change, choice: 'keepMine' | 'takeDisk' | 'compare'): Effect<void>
serialize(path): <A>(effect) => Effect<A>                      // per-path write queue; the one owner of ordering
```

### 4.2 Recovery (11)

```ts
journal(book, receipt, change): Effect<void>                   // append-only, under paths().appData; not the project
pending(): Effect<Restorable[]>                                // on boot: journals newer than their baselines
restore(id, project): Effect<Book>                             // replays onto the saved text; trusted 'recovery'
discard(id): Effect<void>
compact(book): Effect<void>                                    // after a successful save
```

### 4.3 Resources — Import and Library (20, 21) — **schemas exist**

```ts
// exists
decodeBurritoMetadata(value: unknown): Result<BurritoMetadata, SchemaError>
decodeResourceContainerManifest(value: unknown): Result<Manifest, SchemaError>

// proposed
stage(paths): Effect<Staged>                                   // copy into a staging dir; nothing touches the project yet
classify(staged): Effect<Classification>                       // burrito | resource container | loose usfm | unknown
commit(staged, into: project): Effect<Book[]>                  // validated, with provenance recorded
resources(): Effect<Resource[]>                                // stable local identities
bind(role, resource): Effect<void>                             // e.g. 'source', 'notes', 'reference'
resolve(role): Effect<Option<Resource>>
lookup(resource, ref): Effect<Option<Passage>>                 // reference text for a verse
```

### 4.4 Git (24, 25) — port; git2 on desktop, isomorphic-git on Web

```ts
interface Git {
  open(root): Effect<Repo, GitError>; init(root): Effect<Repo, GitError>
  status(repo): Effect<Status>
  commit(repo, receipts: SaveReceipt[], message): Effect<CommitId>
  log(repo, path?): Effect<Commit[]>
  show(repo, rev, path): Effect<Uint8Array>                    // bytes at a revision → a read-only surface or a Baseline
  previousVersions(repo, book): Effect<Version[]>
}
TauriGitLive: Layer<Git>                                       // Rust commands over git2
WebGitLive: Layer<Git, never, FileSystem>                      // isomorphic-git over nodeFsView(OPFS)
gitContract(name, makeLayer)                                   // same fixture repo, same assertions, per tier
```

### 4.5 Remote (26)

```ts
attach(repo, url): Effect<void, GitError, Credentials>
fetch(repo) / pull(repo) / push(repo): Effect<Progress, RemoteError, Credentials | Git>
publish(repo, target): Effect<void>
progress(): Stream<Progress>
```

### 4.6 ProjectAdmin (31)

```ts
rename(project, name): Effect<void>
delete(project): Effect<void, never, Dialogs>                  // confirm; never silently
metadata(project): Effect<BurritoMetadata>; updateMetadata(project, patch): Effect<void>
export(project, format: 'burrito' | 'usfm-zip'): Effect<Path>
```

---

## 5. Shell · Solid, TanStack

### 5.1 Composition — **exists**

```ts
composeApplication(options): Promise<Composition>              // once, at the entry
Composition: { boot; observability; fileSystem?; runtime; layer; dispose() }
CompositionProvider / useComposition()                         // services reach components through context
```

### 5.2 Commands, routing, localization, settings UI (19)

```ts
registerCommand({ id; title; run; when?; keys? })
runCommand(id): Effect<void>
commands(): Command[]                                          // palette source
routes: /projects | /project/:id | /project/:id/book/:book | /find | /findings | /history | /settings | /dev/fixture
t(message, params?): string                                    // the one function strings pass through; lingui later
settingsPanel(): Component                                     // renders registered Settings schemas
```

### 5.3 Drafting and STET (22, 27) — job level, composed from the above

```ts
draftingJob(project, form): Workflow
matchFormatting(source: Book, target: Book): FixPreview[]
stetCompare(project, resource): Comparison
```

---

## 6. Development and verification · **exists**

```ts
FixtureFileSystemLive: Layer<FileSystem>                       // memory layer seeded from fixtures/small-nt
/dev/fixture                                                   // generated route; page code dev-only; 404 in production
pnpm verify:launch [--check]                                   // isolated instance; one JSON line: url, runId, runDir, pid
__sefer.state() / __sefer.observability                        // read-only dev surfaces
keystroke header in the demo: keystroke · phases · analyze · fold · index · build · view
```

---

## 7. The seams, read across

- **Text flows one way**: bytes → `Source.decode` → `Book` → (editor-backed Book when mounted) → `Galley.analyze` → `Analysis` → Findings, Fixes, Search, ProjectAnalysis. Nothing below Book re-parses USFM.
- **Every edit goes through one funnel**: keyboard, paste, windows, fixes, replace, revert, recovery and multi-book operations all end in `submit(changes, origin, trust)`, which runs the phases and yields a `Receipt`. There is no second write path.
- **Every derived product is stamped**, and every consumer checks before acting. `stale` in Findings, `resolveHit` in Search, `Stale` in Fixes and Diff are the same check with different names.
- **Durable modules never touch the editor**: Save takes a `Book`, writes bytes, returns a receipt; Recovery journals receipts; Git commits receipts. They see stamps, not CodeMirror.
- **Host Layers are the only place a host is named.** Six of them: HostInfo, FileSystem, Observability, Settings, Credentials, Dialogs. Two composition roots provide them.
- **Observability is written at operation boundaries**: `boot`, `book.apply`, every phase rule, `save`, `commit`, `analyze`. Pure functions carry no spans.

## 8. Deliberately absent

Domain vocabulary (book code table, reference parsing and formatting) is held by the owner; several signatures above take a `Ref` or `BookId` and will need it. Settings and Credentials have no consumer yet. Nothing here is a service registry; composition roots provide Layers and the rest is constructed from them.
