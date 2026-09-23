# Fallow follow-ups: the unused exports, and component size

**Status:** 2026-09-23, read-only classification; nothing below has been changed yet. Follows [the first pass](fallow-2026-09-23.md).

Sefer is an app, not a library, so the target for unused exports is **zero**. Every unused export is one of three things: dead, internal-only, or built and not yet wired. The work is telling them apart.

## The unused exports, classified

fallow reports 457 unused exports and 169 unused type exports: **626 symbols**. Here is every one of them, bucketed. Most of the bucketing is mechanical: I traced each re-export to its source module and counted uses inside and outside the file. Bucket F needed a judgment on each symbol.

| bucket | count | what it is | what to do | effort |
| --- | --- | --- | --- | --- |
| **A. False positives** | 27 | `services.ts` and `__root.tsx` load `platform/tauri`, `fixture/smallNt` and `dev/designSurface` with `await import()` and read members off the namespace (`tauri.TauriGitLive`). fallow doesn't follow that | Destructure at the import (`const { TauriGitLive, … } = await import(…)`), or add the modules to `ignoreExports`. Destructuring is better, because it also documents what the host provides | small |
| **B. Test-only** | 11 (not in the 626) | Exported for a test and used only there (`makeMemoryFileSystem`, `scopedTo`, `dominantEol`, harness `surface`…). fallow already counts these as used | Nothing | — |
| **C. Barrel lines nobody outside uses** | 224 | An `index.ts` (or a pass-through like `editorState.ts`) re-exports something only its own siblings import. `editor/index.ts` alone has 106; then `primitives` 29, `compare` 15, `panels` 14, `editorState` 11, `sync` 10 | Delete the lines. A barrel should list what the rest of the app actually uses, so "is X public?" can be answered by reading it | mechanical |
| **D. Door bypassed** | 8 | The barrel exports it, but an outside consumer imports the file directly: `review/ReviewPanel` and `cloud/ProjectCard` → `panels/changes` + `panels/history` (`unsavedChanges`, `createRecordedVersion`, `ago`, `exact`); three `describe` imports of `review/sources`; three `findings.ts` types | Point the consumer at the barrel (a one-line import change each). Or, where the file is a shared helper rather than panel-private (`ago`, `exact` are date formatting), move it somewhere neutral | small |
| **E. Used only in its own file** | 280 | `export` on something only its own module uses. Biggest: `editor/index.ts` 42 (re-exports of internal-only symbols), `testing/harness` 10, `theme.ts` 9, `registry` 9, `mapping` 7 | Drop `export`. This is exactly what `fallow fix` automates. Do it after C, so the barrel lines are already gone | mechanical |
| **F. Nobody uses it at all** | 87 (68 distinct symbols) | See below | See below | judgment |

With A–E done, the report is down to F: 87 findings instead of 626.

### F, symbol by symbol

**F1. Built, documented, not hooked up. Keep and wire.** These are the real "should exist" list.

| symbol(s) | where the promise is | what's missing |
| --- | --- | --- |
| `timing.recent/onSpan/summary`, `instrument.dumpTrace`, `trace.traceListener/landingListener`, `inspect.inspect/usfmScrollTo` | `observability.md` §139 promises `globalThis.__sefer.editor` with `keystrokes()`, `spans()`, `summary()`, `traces()`, `trace()`; `editor.md` lists them as the instrument surface | **Nothing installs `__sefer.editor`.** The doc describes a dev surface that isn't there. Worth doing soon, since agent verification leans on these |
| `bootEndpoints` | `configuration.md`: "the Network card records what the composition captured" | The card doesn't read it. Either wire it or correct the doc |
| `sitesOfGlyph` | `inventory.md`: the door for "the other places this character is underlined", from the lint tooltip or a Findings filter | The feature isn't built |
| `severityOf` | Module-seams planning: a severity for a legend or filter list | No legend yet |
| `parseStructure` | Its own doc: structure for bare text, for a satellite's first paint, a probe, a fix preview | No caller yet |
| `chapterList` (whereAmI) | `editor-primitives-consistency.md`, the navigation work | No navigation UI yet |
| `HeadlessDialogsLive` | `host.md`: the headless provider beside Web and Tauri | Nothing headless composes dialogs today. Keep it for host parity, with a `fallow-ignore` naming why |
| `openWindow` (ClipWindow) | `editor.md` documents it beside `mountSatellite` | Lost its only user when ResultCard went. **Needs a ruling:** Find's editable excerpts use `mountSatellite`. If no screen wants a headless clipped state, delete it and its doc paragraph |

**F2. Superseded. Delete, and fix the doc where it still describes them.**

- `core/compare/decisions.ts`: `noDecisions`, `decide`, `decideMany`, `completeness`, `allDecisionIds`. This is the hunk-era decision map. Review moved to the engine's decision units and keeps its own map inline in `ReviewPanel.tsx` (lines 142–414). Better than deleting: re-home that inline map as a core module over decision-unit ids, which is also the first split of ReviewPanel (see below).
- `excerpts.verseAnchor`: `refOccurrences` builds one batched verse map, so the one-reference version is unused. `stet.md` still calls `verseAnchor` "the whole mapping", so fix that line too.
- `findings/filter.groupBy`: `findingsFeed.ts` groups with its own `groupKeyOf`.
- `decorations.baseTheme`: `editor.css` already styles `.cm-scroller` and the height.
- `CANONICAL_FORM`, `EDITOR_ACTIONS`: nothing writes a file-less text, and nothing lists actions.

**F3. Ported-spike leftovers, with nothing planning to use them. Delete; `../onion-2-spike` still has them.**

- `registry.ts`: `RESERVED`, `allCells`, `DEFAULT_ASSIGNMENT`, `isKeystrokeImmutable`, `isElided`, `ownershipAt`.
- `owned.ts`: `illegalTarget`, `TargetForm`.
- `mapping.ts`: `tokenRowsFor`, `classifyNode`.
- `editorState.isHiddenSpan`.
- `recipes/copy.ts` is the whole copy-profiles recipe (`COPY_PROFILES`, `copyProfile`, and its facet). Nothing installs it and no plan mentions it. **Ruling:** is "copy as plain text / as USFM" wanted? If not, delete the file.

**F4. Speculative.** `attrs.alignedWordTooltip` throws `TODO(seam)` from a function nothing installs. The 2026-09-13 build-out review already said to delete it.

**F5. Engine vocabulary re-exported "just in case".** `galley.ts`: `CHANNELS`, `CONVENTION_REASONS`, `BookView`, `TocChapter`, `TocVerse`. `analysis.ts`: `ATTR_STRIDE`, `HEADER_BYTES`, `MalformedAttr`, `Toc`, `Tokens`, `USFM_VERSIONS`, `FixEdit`, `ParseOptions`, `Span`. Trim them. The one-importer rule for the engine still holds, and re-adding one is a one-line change when a caller appears.

**F6. Schema sub-types nobody names.** `BurritoLanguage`, `ResourceContainerLanguage`, `ResourceContainerProject`, `CredentialLookup`. Delete.

**F7. Test harness.** `testing/harness.ts`: `typeAt`, `pasteAt`, `sameButForWhitespace`, `EDIT_KEYS`, `MOTION_KEYS`, `VIEW_MOTION_KEYS`, `SHAPES`, `coincidentStops`, `markupOnScreen`. These are for the editor tests that will come back once behaviour locks. Keep them, with a file-level `fallow-ignore` like `mount.ts`'s.

**F8. Small API ends.** `toasts.dismissAll`, `annotate/hotkey.forgetHotkey`. Delete unless a "clear all" or a "reset hotkey" control is wanted.

### Suggested order

1. **A** (destructure the dynamic imports), then **C**, then **E**: mechanical, one commit each, typecheck proves them. That takes the report from 626 to about 95.
2. **F2–F6** deletions, plus the `stet.md` and `configuration.md` fixes: one commit per module.
3. **F1**: wire `__sefer.editor` (a real gap), then decide `bootEndpoints` and `openWindow`. Mark the rest `fallow-ignore` with the plan they wait for, so the count reaches **zero with every remaining exception named**.
4. Then gate it: `fallow dead-code` with `unused-exports` at `error`, so a new export nobody uses fails `pnpm check`. From then on, a symbol that's built ahead of its screen has to say which screen it's waiting for.

Rulings needed: `openWindow`, the copy-profiles recipe, `bootEndpoints` (wire the card or fix the doc), and whether F8 stays.

## Component size

fallow's largest functions, read for their real seams. Churn is `git log --follow` commits, nearly all from the last two weeks. The theme across all of them: **most of the length is the same half-dozen patterns written by hand in each file**, not tangled logic. Shared helpers shrink every file at once. Splitting one file at a time would move the repetition around instead.

### Shared patterns first (these shrink several files each)

| helper | replaces | sites |
| --- | --- | --- |
| `followSetting(services, key, onValue)` | signal + `runFork(Stream.runForEach(settings.changes(key)))` + `onCleanup(interrupt)` | 9: ProjectContext ×4 (511, 531, 545, 593), BookEditor ×2, ReferencePane, findingsFilter, settings.tsx |
| `debouncedPersist(key)` | the 400 ms persist timer | ProjectContext ×3 |
| `trackedRun(services, name, attrs, effect, { toast })` | operation span + progress toast + end-once guard + `describe` | ReviewPanel 509–570, ImportHub ×3, RecoveryBanner ×2, CloudScreen |
| one fix workflow (`app/workflows/fixes.ts`) | seated book → analysis → `Fixes.preview` → `Fixes.apply` → report | ProjectContext `applyFix` 1168, FindingsPanel 313–346 |
| one `restoreJournal` workflow | instantiate → adopt → restore | ReviewPanel 705, RecoveryBanner 139 |
| wrap-around cursor | the step-with-wrap arithmetic | find 595, FindingsPanel 275, ProjectContext 1145 |
| `editing()` exported | the typing-target guard | commands 245, FindingsPanel 357 (the annotator's `isTyping` stays separate; it's framework-free) |
| `cmMode(mode)` | `mode()==="usfm"?"usfm":"regular"` | 6 files |
| `shell.revisions()` in shellStores | per-book revisions memo | ReviewPanel 219, FindingsPanel 190 |

Two outright copies to fold while doing this:
- `ImportHub` has its own local `describe` (line 81), although `src/app/describe.ts` says "there must be exactly one of these: three copies drifted apart once already".
- `ImportHub`'s `importFolder` and `importPicked` are about 80% the same text, and could become one `runImport({ title, pick, stage })`.

### Per file, in payback order

1. **`ProjectContext.tsx` `makeShell`** (844 lines, 33 commits, the most churned).
   - Extract `createShellPreferences` (501–656; reads Settings only, and most of it is `followSetting` ×4), `createSlugs` (557–582), `createFindingCursor` (1139–1189) and `createLocationMemory` (920–1055).
   - `createLocationMemory` **needs care**: it borrows the plain `live` handle and relies on `untrack` reads, so pass `live` as a getter and don't turn it into a signal.
   - **Keep together:** open, close, focus, `showChapter` and the `pendingPlace` effect (717–1137). They're one lifecycle state machine.
2. **`commands.ts` `registerShellCommands`** (718 lines, 26 commits). A flat list, so split it into `registerNavigation/Editor/Findings/Remote/FormatCommands` (mechanical).
   - `book.save`, `project.saveAll` and `git.commit` have identical bodies, so one `openReview()` covers them.
   - **Ruling:** `format.match.book` (763–843) and `overlay.book` (879–988) both mean "match this book's formatting to the source". But they find the source differently, and only one keeps scroll, targets the first empty block and turns on ghost paragraphs. Is that deliberate?
3. **`find.tsx` `Find`** (713 lines, 21 commits).
   - **Ruling first:** Replace all is here (about 110 lines plus a settings key), off by default behind Advanced, added 2026-09-21. It conflicts with the "no Replace in Find" rule. If the rule stands, deleting it is the biggest single shrink.
   - Then extract `FindBar` (609–718, presentational) and the reference pairing (522–566; `pairFor` is pure and can sit beside `refOccurrences` in core).
   - `createFindSearch` (289–379) **needs care**, because Solid's write batching is why the `Over` pattern and the untracked URL effect exist.
4. **`FindingsPanel`** (603 lines, 17 commits).
   - `FindingLine` plus its decor (398–547) into its own file (mechanical).
   - `createFixOffer` + `FixPreviewCard`, on the shared fix workflow.
   - `createCardCursor`.
   - A generic `afterFirstPaint()`.
   - **Keep together:** `pool`/`revisions`/`summary`/`shown`. The deferred first paint only works because nothing but the feed reads `shown`.
5. **`ReviewPanel`** (1035 lines, 8 commits). The file already marks its sections with `// ---`, and each section is a real seam:
   - `RecoveredWorkCard` + `createJournals`.
   - `RecordVersionCard` (owns `message`/`recording`; `record()` becomes a workflow).
   - `createReviewSides` + `Picker`.
   - `ReviewUnits` and `ApplyConfirmDialog` (presentational).
   - The decision map (142–414) into core, over decision-unit ids. This replaces the superseded hunk-era `compare/decisions.ts` (F2 above).
   - **Behaviour/perf, not only a move:**
     - `currentPlan` is a plain function called four times per render, and each call reruns `diffSkeleton` plus `mergeWithDecisions` per changed book. It should be a memo, `planFromDecisions` in core.
     - `skeleton` and `diffRefusal` (335–360) compute the same `diffSkeleton` twice.
6. **`projectAnalysis.ts` `make`** (479 lines, core).
   - `makeQuietScheduler` (pending/latch/armed), `makeDerivedFindings` (the three caches), `makeReferenceRegistry`.
   - One `touch(bookId)` for the stale → invalidate → arm step repeated three times.
   - The returned service is a flat method list; leave it.
7. **`ImportHub`** (491 lines, 7 commits). `runImport` plus the `describe` fix above, then `CloneDialog` and `ImportProgressDialog`. The comment at 360 says `clone` is reused by the catalogue; it isn't.
8. **`annotate` `mountAnnotator`** (761 lines, dev only, framework-free). Move only the pure widget builders (`createHost`, `segmented`, `tweakField`, `rows`/`numbering`, `renderPins`). Anything further means designing a state object.
9. **`owned.ts` `buildOwnedIndex`**: leave it. Ported once and never touched since. `backward` and `forward` look like mirrors but aren't.

### Stale docs and comments found on the way

- `shell.md` 32–34 still describes `bump()`/`tick()`. The code moved to `shell.changed` plus `shellStores`.
- `find.tsx` 480–484 and `projectAnalysis.ts` 408–415 are orphaned doc comments. In `commands.ts`, the "Format" header at 737 sits above the wrong block.

### Suggested sequence

1. The shared helpers and the two ImportHub dedupes: small diffs that touch many files.
2. `ProjectContext`, then `commands.ts`, then `find.tsx`. These three pay back most (highest churn, mostly mechanical cuts), and `find.tsx` may shrink by deletion alone.
3. `FindingsPanel` and `ReviewPanel`, with ReviewPanel's plan memo treated as a behaviour change to verify in the browser.
4. `projectAnalysis`, then `ImportHub`'s dialogs. `annotate` only if it keeps growing.

Rulings needed: Replace all in Find; `format.match.book` versus `overlay.book`.
