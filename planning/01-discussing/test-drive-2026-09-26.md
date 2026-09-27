# Test drive: excerpt cards, the diff playground, the history index (2026-09-26)

**Status:** three prototypes to drive, tune and then decide on, all on ONE branch, `review/2026-09-26`, checked out at `.claude/worktrees/review-2026-09-26` (master plus the history work replayed on top). Nothing here is pushed. Measurements are one machine (macOS arm64), Chrome through the CDP rig, the dev server — not a build — on `WycliffeAssociates/en_ulb` (66 books, 11,998 commits).

## Before you start

- **Where en_ulb lives.** The imported en_ulb project and its Git history are in the CDP Chrome profile's OPFS (`~/.sefer-cdp-profile`), under the origin `http://127.0.0.1:3001`. In another browser, import it once from the Projects page (WACS → `en_ulb`, full history).
- **One dev server for all three.** In the review worktree: `cd .claude/worktrees/review-2026-09-26 && pnpm dev --host 127.0.0.1 --port 3001`. Port 3001 matters only because that is the origin en_ulb was imported under.
- **Reading what it did.** Every step below is traced in the app's ring. In DevTools: `__sefer.observability.traces.recent()` for operations with their spans, `__sefer.observability.logs.recent()` for loose spans, `__sefer.observability.errors()` for anything that failed. The names to look for are given per feature.
- **Driving it from an agent.** `pnpm verify:chrome` starts the CDP Chrome; Playwright's `chromium.connectOverCDP("http://[::1]:9222")` attaches. Interaction cost is best read with the Event Timing API (`PerformanceObserver` on `event`, what INP reads), not a stopwatch around Playwright calls, which adds ~60 ms of round trips.

## 1. Excerpt cards in Find, Key terms and Findings

**What it is.** One card for every list of places: the editor's own reading of a TOC unit and its context, read-only; double-click or Edit turns it into the satellite (caret where you clicked); ↑ / Chapter / ↓ step through the TOC; a paired resource beside it (Find's Reference scope, Key terms' guide text); the results outline in the sidebar's place; cards follow the seat live while any card or the editor edits the book. Plan: `planning/00-ideas/excerpt-compound-component.md` (decisions, what was built, the measurement table).

**Drive it:**

1. Open `http://127.0.0.1:3001/project/en-ulb/book/PSA` and wait a few seconds for the project's background analysis (a search straight after opening is slow because of it, not the cards).
2. Type `the` in the toolbar search and press Enter: 86,556 hits. Scroll the list; use the sidebar outline (book rows, chapter tiles) to jump.
3. On a card: ↑ / ↓ / Chapter; double-click a word to edit; type; Done. Edit a verse two cards show (e.g. Psalms "Yahweh", This book, cards 14:2 and 14:4 both show v. 3) and watch the other follow.
4. Reference scope: Find → Reference (needs a bound source or reference resource) — the reference text sits beside your verse, locked to its range; narrow the window to see it stack and collapse to the match.
5. Key terms: pick a term (e.g. `grace` on the fixture) — the guide's frozen reading as the paired resource.
6. Findings: the same cards with severity tones and findings in the notes slot.
7. The renderer switch: palette → "Show advanced settings" → Settings → Advanced → **Result cards**: _Editor views_ (default, a pooled read-only CodeMirror view per card) or _Stamped HTML_ (one hidden view renders, the card gets a copy of its DOM). Reopen Find after switching.
8. Setting: Settings → Editor → **Context around a result** (TOC steps either side; read when a list opens).

**Traces:** `find.run` (the search), `find.group` (books regrouped and reused), `find.openInEditor`; the editor's own `editor.mutation` while a card is being typed in.

**Measured, "the" over en_ulb** (worst Event Timing per interaction):

| Operation                                |                   Editor views |                 Stamped HTML |
| ---------------------------------------- | -----------------------------: | ---------------------------: |
| Search to first cards                    |                     292–412 ms |                   250–318 ms |
| of which the search (one long task)      |                     199–226 ms |                   172–173 ms |
| Next match / context step                |                     16 / 32 ms |                   16 / 32 ms |
| Chapter on / off                         |               32–40 / 56–64 ms |                   24 / 32 ms |
| Double-click to edit                     |     **40–48 ms** (was 104–112) |   96–104 ms (before the fix) |
| Keystroke while editing                  |                          24 ms |                        32 ms |
| Done                                     |          **56 ms** (was 72–80) |       72 ms (before the fix) |
| Outline jump / This book / Whole project | 112–120 / 136–144 / 144–168 ms | 88–96 / 104–112 / 144–152 ms |
| Scroll per frame p50 / p95               |                     17 / 22 ms |                   17 / 19 ms |

Still over 50 ms: the search itself (stream it per book), a scope change (a new search), the outline jump to a far book (twenty cards mounted at once).

**Code:**

| Piece                                                                    | Where                                                                                                                                          |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| The model: TOC-unit grouping, TOC-step context, paired lock, reading end | `src/core/excerpts/excerpts.ts`; Location's units in `src/core/location/locate.ts` (`tocUnits`, `unitIndexAt`, `unitAddress`)                  |
| The card, its reader and editor                                          | `src/app/ui/excerpts/ExcerptCard.tsx`, `ExcerptReader.tsx`, `ExcerptEditor.tsx`                                                                |
| The list and the sidebar outline                                         | `src/app/ui/excerpts/ExcerptList.tsx`, `ResultsOutline.tsx`; the slot in `src/app/ui/workspace/sidebarSlot.ts`, drawn by `src/routes/_app.tsx` |
| The feed: grouping per book with reuse, widening per card, seats         | `src/app/ui/excerpts/feed.ts`                                                                                                                  |
| The read-only view, the stamp, the pool                                  | `src/editor/recipes/reader.ts`, `stamp.ts`, `viewPool.ts`; the clip and marks in `satellite.ts`                                                |
| The windowing                                                            | `src/app/ui/primitives/VirtualList.tsx`                                                                                                        |
| Screens                                                                  | `src/routes/_app/project/$slug/find.tsx`, `terms.tsx` + `src/app/ui/excerpts/StetView.tsx`, `src/app/ui/panels/FindingsPanel.tsx`              |
| Settings                                                                 | `src/app/settings.ts` (`excerpts.context`, `excerpts.renderer`)                                                                                |

## 2. The diff playground: in the editor, and as excerpts

**What it is.** The engine's decision-unit diff (`galley.diff`: units with spans into each side's own text, word runs inside a modified unit) drawn on the editor's own reading — never a line differ. Two experiments beside the older `Continuous` and `Excerpts`:

- **In the editor** — the whole book, split (earlier left, working right; the other pane follows your place by unit) or unified (removed words struck through inline, removed units as blocks).
- **Changes as excerpts** — every change as a clipped card with TOC-step context, neighbours whose context overlaps sharing a card, across one book or all books; "markup only" / "whitespace only" badges from the engine's classification.

Both: regular or USFM mode; per-unit gutter controls — ↶ takes the earlier text for that unit (through `galley.merge`, then re-diffed), ✓ marks it reviewed. The working text is a copy: nothing is written to the book.

**Drive it** (the baseline is a synthetic earlier draft — reworded, shortened, absent and markup-only verses — so every kind of change is on screen):

- In the editor: `http://127.0.0.1:3001/project/en-ulb/playground?experiment=editor-diff&book=PSA&density=normal` — dials _Layout_ (split / unified), _Mode_ (regular / usfm), _Unit controls_.
- As excerpts: `…/playground?experiment=excerpt-diff&book=PSA&density=normal` — dials _Layout_, _Mode_, _Books_ (this book / all books), _Context_ (0–2 steps), _Unit controls_. All books fills book by book (~3 s for 66).
- The frame's dials above both: _Book_, _Against_ (synthetic draft, or what is on disk), density (light / normal / heavy). Everything is in the URL, so a variant is a link.

**Traces:** `playground.diff.compare` (the engine diff), `playground.diff.show` with its `playground.diff.mount` span, `playground.diff.take`, `playground.diff.follow` (a span per followed frame), `playground.diff.excerpts` with a `playground.diff.book` span per book.

**Measured:** Psalms diff 18 ms (2,656 units); In the editor mount 64–148 ms split, 41–57 ms unified; take 7 ms. As excerpts, all 66 books: 2,799 cards in 2.8–3.1 s; a card mounts in 1.6–1.8 ms (6.9 ms split on one long book); scroll p95 23–32 ms.

**Known rough edges:** in USFM split the follower can sit a line or two off (bare markup lines are their own visual lines there); ↶ and ✓ are cryptic; unified struck text can crowd a line; "take" is an edit the card does not yet announce as one.

**Code:**

| Piece                                                                               | Where                                                              |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| The diff view recipe (paint, tints on visual lines, gutter controls, optional clip) | `src/editor/recipes/diffView.ts`                                   |
| Shared paint, cards, the whole-book view (also `/review`'s)                         | `src/app/ui/diff/`                                                 |
| In the editor                                                                       | `src/dev/playground/experiments/editorDiff.tsx`                    |
| Changes as excerpts                                                                 | `src/dev/playground/experiments/excerptDiff.tsx`                   |
| The bench (synthetic draft, disk baseline) and the frame                            | `src/dev/playground/bench.ts`, `PlaygroundPage.tsx`, `registry.ts` |
| Styles                                                                              | `src/editor/editor.css` (`.cm-diff-*`)                             |

## 2b. `/review`: the diff surface for the PO (2026-09-27)

**What it is.** The two playground experiments made one screen, in the real `/review` with real sources and decide-then-apply. Three layers: the engine (units, the decision map), layout (split / unified / auto), scope (changes as cards across every book / the whole book). Kind filter (All / Words / Markup and spacing); next/previous change; decisions per unit, card and book. `documentation/architecture/review.md`, "The reading: three layers".

**Drive it:** edit a few verses in two or three books, then open `http://127.0.0.1:3001/project/en-ulb/review` (editor against disk is the default). Flip Changes / Whole book, Auto / Side by side / Unified, the filter; press `Alt-F5`; double-click a card; decide with ✓ / ↶ in the gutter; Apply. On the dev channel this is the deployed `/review`, so the PO can drive it there once it is on master.

**Traces:** `review.compare` (as before), `review.diff.prepare` with a `review.diff.book` span per book, `review.diff.book` operation per whole-book mount with `review.diff.mount`, spans `review.diff.step` and `review.diff.follow`.

**Measured (3 books, 7 units):** compare 15–33 ms, prepare 33–128 ms (the parses), a step 0.1–3 ms, a follow 0.1–2.8 ms.

**Code:** `src/app/ui/review/ReviewReader.tsx` (toolbar, scope, nav, bulk), `src/app/ui/diff/` (`paint.ts`, `hunks.ts`, `DiffCard.tsx`, `BookDiff.tsx`), `src/editor/recipes/diffView.ts`; settings `review.layout`, `review.scope`.

## 3. History: the book-change index

**What it is.** The plan's primitives 1, 3, 5a and 6a–6c, driving the history timeline: a pack-cached Git view; an all-books change index built in a worker under a shared Web Lock, stored outside the project and extended incrementally; a book's history from it in milliseconds; each commit's other changed books; a merge's common ancestor and changed-on-both-sides facts. Plan: `planning/01-discussing/local-review-and-history-plan.md` ("Prototype on the spike branch"); numbers and links in `planning/scratch/history-metadata-spike.md`.

**Drive it:**

1. `http://127.0.0.1:3001/playground/history-diff?project=en_ulb&book=01-GEN.usfm` — the first open builds the index in the background (~5 s; progress beside the book picker) while the timeline walks; the next open is from the stored index ("history index stored").
2. Scroll left through the slides; each header says which other books that commit changed.
3. A merge with facts: `…?project=en_ulb&book=10-2SA.usfm&at=e17df4f2c220`.
4. To force a rebuild, delete `/sefer/history/` in OPFS (DevTools → Application → Storage), or rewind the stored JSON to test an extend.

**Traces:** `history.index.ensure` (spans `load`, `tip`, `build` — with the worker's lock wait, pack load, walk time and filesystem call counts — and `save`), `history.book.open` (`source: index` or `walk`), `history.merge.facts` (spans `base`, `books`, `passages`).

**Measured:** index build 4.9 s cold (was 30.6 s before the `.git` stat was remembered — isomorphic-git stats `.git` on every command), 10 filesystem calls; extend by 49 commits 391 ms; stored open ~35 ms (2.76 MB); a book's history 19 ms; first slide with no index 1.4 s; merge facts ~0.5 s.

**Not built:** shallow clone then deepen in the worker; the exclusive lock on the app's own writers; remote branches in the index; a two-points picker. The spike's four test files and its OPFS fixture were left behind in the old spike worktree (no-tests rule).

**Code:**

| Piece                                               | Where                                                                                                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Pack-cached view                                    | `src/dev/playground/history/packView.ts`                                                                                       |
| Index, history, merge base, two points, blob lookup | `src/dev/playground/history/bookIndex.ts`                                                                                      |
| Worker and store                                    | `src/dev/playground/history/indexWorker.ts`, `indexStore.ts`                                                                   |
| The timeline page                                   | `src/dev/playground/HistoryDiffPage.tsx`, the walker `bookHistory.ts`; the route `src/routes/_app/playground/history-diff.tsx` |

## Commits

`review/2026-09-26`, on top of the day's master commits (`69a2366` card … `07de31a` follow check, all unpushed): `fa599e2` the history index, pack view and timeline, then this note's update and the dead-code tidy. The old spike worktree (`~/.codex/worktrees/history-metadata-spike`, branch `history-spike`) is superseded and can be removed once this is reviewed.
