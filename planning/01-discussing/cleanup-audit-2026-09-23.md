# Cleanup audit — planning, docs, comments (2026-09-23)

Read-only audit of `planning/`, `documentation/`, `AGENTS.md`/`CLAUDE.md`, the two skills, and code comments across `src/ tools/ workers/ e2e/ src-tauri/`. Code was treated as truth. Nothing was edited or deleted; the fallow agent was mid-pass in `src/`, so a few symbols named below were removed in its working tree (marked **WT**).

## 0. Real bugs found along the way (not doc rot)

1. **Preview desktop builds report channel `stable`.** `src/platform/tauri/updater.ts:89` tests `identifier.endsWith(".nightly")`; the preview identifier is `org.wycliffe.sefer.preview` and `tauri.conf.nightly.json` does not exist. `UpdateChannel = "stable" | "nightly"` in `src/core/host/updater.ts:27` carries the old name.
2. **Incoming-plan "compare" link is dead.** `src/app/ui/cloud/IncomingPlanCard.tsx:32` links to top-level `/compare?book=…`; the scoped `/compare` redirects to `/review` and drops `book`.
3. **Recovery replay has no base check.** `recovery.ts:444-460` replays the journal onto whatever text the book has now; an external edit after the journal began puts edits at wrong offsets. One bad line marks the whole journal `Corrupt` and it is skipped silently.
4. **`recovery.attach` runs on every `focus`** (`ProjectContext.tsx:853`), adding a subscription each time, in the app scope — closed projects' subscriptions live until app dispose.
5. **UI copy contradicts the save model.** `HistoryPanel.tsx:321`: "Your books are still written to disk as you work."
6. From the 09-13 review, still true: `git_pull` uses `CheckoutBuilder::force()` with no dirty check (`git.rs:776`); `git_push` has no `push_update_reference` rejection callback; keychain `service` comes from the webview, `csp: null`, fs scope includes `$HOME/**`; author hard-coded `sefer@localhost` in three places (`ReviewPanel.tsx:109`, `CloudScreen.tsx:63`, `web/remote.ts:72`).
7. `SaveCoordinator.externalChanges`/`resolve` exist but nothing in `src/app` calls them; Web has no `watch` at all.
8. Broken links in CI config: `release.yml:38` and `workers/README.md:30` → `planning/02-ready/git-proxy.md` (never existed).

## 1. Planning: verdict per file

### Delete (done or superseded; fix the listed inbound links first)

| file                                                              | why                                                                                         | inbound links to fix             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------- |
| 00-ideas/v2-01 boot                                               | done (`composition.ts`, `services.ts`, `boot.ts`)                                           | `composition.md:14`              |
| 00-ideas/v2-03 engine boundary                                    | done (tagged scripture-kitchen dep)                                                         | —                                |
| 00-ideas/v2-05 editor donor                                       | done (`src/editor/core/*`)                                                                  | —                                |
| 00-ideas/v2-06 transactions/undo                                  | done (`Book.apply`, `funnel.ts`)                                                            | —                                |
| 00-ideas/v2-07 views                                              | done (`views.ts`, `clip.ts`)                                                                | —                                |
| 00-ideas/v2-13 project analysis                                   | done (`ProjectAnalysisLive`)                                                                | —                                |
| 00-ideas/v2-14 findings                                           | done                                                                                        | —                                |
| 00-ideas/v2-16 read-only surfaces                                 | done (`recipes/reference.ts`)                                                               | —                                |
| 00-ideas/v2-17 editable satellites                                | done (`satellite.ts`, `noteEditor.ts`, `ExcerptEditor`)                                     | —                                |
| 00-ideas/v2-18 search                                             | done; Replace all behind Advanced                                                           | —                                |
| 00-ideas/v2-23 diff and revert                                    | superseded by engine decision units                                                         | —                                |
| 00-ideas/v2-24 fs + git probe                                     | superseded (effect/FileSystem; git2 on desktop)                                             | `storage.md:36`                  |
| 00-ideas/v2-26 remote                                             | done (`core/remote`, `core/sync`, `/cloud`)                                                 | —                                |
| 00-ideas/v2-27 STET                                               | done; stand-ins already listed in `stet.md`                                                 | —                                |
| 00-ideas/v2-28 multibook                                          | done                                                                                        | —                                |
| 00-ideas/v2-source-review                                         | a 09-04 upstream snapshot                                                                   | —                                |
| 00-ideas/v2-module-dag, v2-module-seams, v2-editor-and-save-seams | replaced by the one-pagers (§3); salvage listed there                                       | `editor.md:185`, `findings.md:3` |
| 01/build-out-2026-09-08                                           | historical; open residue carried below                                                      | —                                |
| 01/engine-handoff-v0.1.0                                          | consumed                                                                                    | —                                |
| 01/observability-glossary                                         | folded into `glossary.md`                                                                   | —                                |
| 01/isomorphic-git-effect-filesystem-lifecycle                     | decisions taken in code; salvage the lifecycle state machine + `git.*` spans idea into Git  | `documentation/README.md:39`     |
| 01/fallow-2026-09-23                                              | resolved; merge its three rulings into the follow-ups                                       | `AGENTS.md:57`                   |
| 02/design-surface                                                 | done; lives in `design.md` + skill                                                          | —                                |
| 02/engine-revendor-checklist                                      | done; describes `vendor/galley`, which is gone                                              | —                                |
| 02/updater-worker                                                 | done; residue (updater routes, first `.sig` release) → release-channels skill "still to do" | `wrangler.jsonc:27`              |
| 03/click-through-guide                                            | stale in many rows; regenerate later if wanted                                              | —                                |
| 03/gap-analysis                                                   | mostly closed; residue carried below                                                        | —                                |

### Move into `documentation/` (durable principles, not plans)

- `00-ideas/nearly-no-mocks-testing.md` → `documentation/architecture/testing.md` (or its own `test-doubles.md`). Links: `README.md:8`, `testing.md:3`.
- `00-ideas/local-observability-and-agent-evidence.md` → fold its principles into `observability.md`; its open questions go to the Observability one-pager. Link: `observability.md:3`.
- `00-ideas/v2-README.md` "Inherited constraints" + seams §7 "the seams, read across" + "Effect at the edges, interaction path is synchronous" + the frame budget from v2-29 → **fill `documentation/INVARIANTS.md`** (currently 0 bytes, nothing links to it).
- `00-ideas/v2-02` → already in `testing.md`/`verification.md`; delete after noting its residue.
- `01/event-inventory` "Shipped" table → `observability.md`. Link: `src/core/observability.ts:51`.
- `03-ui/design-direction.md` → `documentation/architecture/design-direction.md` (16 files cite it; a sed on the path).

### Keep, open (these are the real backlog)

| file                                                                                              | status                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01/editor-primitives-consistency                                                                  | **open, as you thought.** No `src/core/location`; `Reference`/`Ref` still duplicated; `buildRefTable`/`refFrom` and Library's `CHAPTER` regex still exist; the mode bundle is still built by hand in three places. §5 (borrow protocol) is half obsolete, because `openWindow` was deleted, so rewrite it. |
| 01/next-git-considerations                                                                        | **open, as you thought.** Base exists (`show`, `previousVersions`, HistoryPanel). Missing: read-only historical pane, prev/next, chapter filter, bounded `log` (no `depth`). History still uses the line diff.                                                                                             |
| 01/commenting-and-discussion                                                                      | **open, nothing built.** Depends on the Location work; the five owner decisions are unanswered.                                                                                                                                                                                                            |
| 01/web-translation-notes-import                                                                   | **open, nothing built.** Only the `tn` role name exists.                                                                                                                                                                                                                                                   |
| 01/engine-asks-2026-09-14                                                                         | partial. Items 8/9/10 were delivered upstream in v0.1.3 but **Sefer doesn't use them yet** (`TextRun` still `{text,kind}`; second masker in `review/reading.ts`). 6/7 are moot. 2 and 4 are still open upstream.                                                                                           |
| 01/rfc-skeleton-row-spans                                                                         | Sefer side done; hand it to scripture-kitchen, then delete here                                                                                                                                                                                                                                            |
| 01/build-out-review-2026-09-13                                                                    | its unfixed items are §0.3, 0.4 and 0.6. Move them to one-pagers, then delete.                                                                                                                                                                                                                             |
| 01/ui-state-stores                                                                                | done except the lazy per-book `group()` (~80 ms O(all findings)). Repoint `shell.md`, `ProjectContext.tsx`, `shellStores.ts`, then delete.                                                                                                                                                                 |
| 01/fallow-followups                                                                               | active: shared helpers, component splits, the unused-exports gate, format-vs-overlay unification                                                                                                                                                                                                           |
| 02/wacs-proxy-rollout                                                                             | ops todo: dev `languageApiUrl` (`channels.ts:67`); browser-check prod `/__meta` (curl hit a Cloudflare challenge)                                                                                                                                                                                          |
| 00-ideas/v2-04, 08, 09, 10, 11, 12, 15, 19, 20, 21, 22, 25, 29, 30, 31, dev-fixture, tauri-specta | partial or not started. Their residue is folded into the one-pagers below; once that's done the files can go. v2-08 (IME, screen reader, webviews) has **not started**.                                                                                                                                    |
| 04-parked/parked.md                                                                               | all four items are still valid and still parked                                                                                                                                                                                                                                                            |

**Folder rename:** `03-ui` holds reference + review material, not UI. After the moves above it would be empty; drop it, or rename it `03-review` if you want the cadence ideas → discussing → ready → review.

## 2. What is actually left to do, by service

This is the "where am I going" list: every open item from every planning doc and audit, deduplicated. It is also the seed for the "Constraints and known bugs" and "Ideas" sections of the one-pagers.

**Location / references (next up)** — editor-primitives §1–3, 5: `src/core/location` with one address type, `parseNavigation`, `at`/`covering`/`resolve` over the TOC; delete `buildRefTable`/`refFrom`, Library `CHAPTER`, the `showReference` scan; one mode-bundle helper (+ `cmMode`); satellite still dispatches selection when `submit` refuses (`satellite.ts:175`).

**Git / History (next up)** — historical read-only pane + prev/next; bounded `log`; baseline choice; chapter filter via Location; History onto decision units (drop line diff); repository lifecycle (absent/busy/unhealthy/closing); serialize mutations; `git_pull` dirty check; push rejection callback; author from Settings.

**Diff** — one diff: move `core/diff/diff.ts` users (`compareBooks`, `projectSource.apply`, HistoryPanel, DiffView, `changes.ts`, UnitCard) onto the skeleton; consume engine runs `{from,to,what}` and delete the second masker.

**Recovery** — base check before replay; recover valid prefix / surface corruption; retention cap; flush on `pagehide`; per-project scope and guarded attach.

**Save** — wire `externalChanges` with a conflict prompt (keepMine/takeDisk/compare); Web has no watch; disk-identity check at save (or record the deferral); partial `saveAll` failure reporting.

**Project** — no caller of `project.release` (books never evicted); one book vs LRU (open question); name rejected books; InvalidUtf8 repair path; add/remove book is `Unsupported`.

**Findings / Fixes** — first `setSettings` caller must invalidate caches; chapter/range format; unify `format.match.book` + `overlay.book` into one scoped source-match action (the naming pass); Sous census and chapter labels (upstream).

**Search / Excerpts** — lazy per-book `group()`.

**Import / Library** — zip path-traversal check (`intake.ts`); refuse duplicate ids at commit; TN reader + pane + web TN import; key-terms guide as a Library resource; missing-binding UI.

**ProjectAdmin** — `create` (Create flow stops before writing); metadata editor (`updateMetadata` has no caller); delete has no trash.

**Shell** — Lingui (`t` is identity); drafting stub (implement or delete).

**Observability** — decide levels and the production default (the doc says `info`, the code says `all`); desktop JSONL persistence; user "export diagnostics"; make the five note-only operations real; instrument catalogue/review/cloud/terms/inventory.

**Host / Desktop** — Web can't open a folder on disk; no `storage.persist()`; Tauri CSP + keychain + fs scope; updater routes and first signed release; transfer progress (`tauri/remote.ts:141`); tauri-specta at ~30 commands (23 today).

**Input / a11y (v2-08, not started)** — pick writing systems and IMEs; IME/RTL/screen-reader/keyboard passes in both modes and three webviews.

**Release** — service worker for offline cold start; platform matrix; v1 parity ledger and migration.

**Performance** — one large fixture; one baseline measurement (keystroke tail + memory across book switches).

**Unbuilt features** — commenting and discussion; drafting; Create.

## 3. One-pager proposal

One file, `documentation/services.md`: a current DAG at the top (redrawn from real imports; the old one has ~13 wrong edges), then one `##` per service in your shape:

```
## <Service>
### Overview            plain language, 3–6 lines, + src path(s)
### Constraints and known bugs
### Ideas / future
Details: → architecture/<doc>.md#section
```

Services (grouped under `#` headings):

- **Host:** HostInfo · FileSystem · Settings · Credentials · Dialogs · Updater · Observability
- **Engine:** Galley · ProjectAnalysis
- **Text:** Source and Book · Project · Location/Reference _(no doc today)_
- **Editing:** Editor · Satellites · MultiBook
- **Proofreading:** Findings (+Inventory) · Fixes (format, source-match)
- **Find:** Search · Excerpts
- **Compare:** Diff · Review/Compare
- **Durable:** Save + Baseline · Recovery (+Schedule) · Git
- **Online:** Remote (+Gitea) · Sync · Catalogue
- **Resources:** Import (+Web intake) · Library · ProjectAdmin
- **Shell:** Shell (composition, commands, routes, stores, i18n) · UI layer
- **Workflows:** Key terms (STET) · Drafting _(Ideas only until real)_ · Commenting _(Ideas only)_

In code but missing from the old DAG: Project, Dialogs, Updater, Compare/Review, Sync, Excerpts, Inventory, Reference/canon, Schedule, Catalogue, Gitea, ProjectMetadata/checksum, Web intake.

**Salvage from the seams docs:** seams §7 rules → INVARIANTS; editor-and-save open question 1 (one book vs LRU) → Project "Ideas"; open question 4 (Worker for ProjectAnalysis) → ProjectAnalysis "Ideas".

Once this exists, `composition.md` (mostly stale) folds into Shell, `diff-and-multibook.md` splits into Diff and MultiBook, and the `README.md` index can point at `services.md` first.

## 4. Documentation rot, worst first

| doc                                                                                                                                                                                                              | health       | the main problems                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search.md`                                                                                                                                                                                                      | mostly stale | written around `findProjected`/engine memmem; the reality is `findInReading` over readings in JS, regex allowed, no limit, `resolveHit`/`replace`/`refAt` gone. Rewrite.                                                                                                                                                                                                           |
| `composition.md`                                                                                                                                                                                                 | mostly stale | says the filesystem isn't composed and Tauri has no commands (it has 22–23). Fold into Shell.                                                                                                                                                                                                                                                                                      |
| `INVARIANTS.md`                                                                                                                                                                                                  | empty        | fill it (§1) or delete it                                                                                                                                                                                                                                                                                                                                                          |
| `AGENTS.md`/`CLAUDE.md`                                                                                                                                                                                          | significant  | fixture path is `_app/dev/fixture.tsx`; "dev build" means the dev server; `__sefer.observability` shape is `traces/logs/export/level/setLevel/stream`; preview tag is `v*-N` not `v*-rc*`; "no host provides FileSystem yet" and "isomorphic-git lifecycle not established" are false; "scaffold" framing; index missing ~12 docs; CI gates omit `release.yml verify` + `deadcode` |
| `galley.md`                                                                                                                                                                                                      | significant  | `CorpusEngine`/`WasmCorpusLive`/`accepts(manifest)`/`decodeHits` gone; `analyze` has two doors; missing door inventory (lint, toc, mask, diff/merge, formatEdits, overlay…)                                                                                                                                                                                                        |
| `observability.md`                                                                                                                                                                                               | significant  | Levels section wrong; dev surface shape wrong; boot is an operation; event names (`editor.mutation/selection/render`); planning prose                                                                                                                                                                                                                                              |
| `shell.md`                                                                                                                                                                                                       | significant  | `$id`→`$slug`; route list; `/terms` and `/compare` "not yet" (they exist; compare redirects); "What is stubbed" nearly all false; `landingPath`→`landingTarget`                                                                                                                                                                                                                    |
| `sync.md`                                                                                                                                                                                                        | significant  | desktop "refuses four methods" false; cites deleted tests; `/compare` link; `syncStateOf`/`planCombine` private (door is `sync()`)                                                                                                                                                                                                                                                 |
| `stet.md`                                                                                                                                                                                                        | significant  | Match formatting section describes the removed `/terms?view=format` UI; old flat route paths                                                                                                                                                                                                                                                                                       |
| `resources.md`                                                                                                                                                                                                   | significant  | "no import flow" (there is one); reference pane has caret pairing                                                                                                                                                                                                                                                                                                                  |
| `storage.md`                                                                                                                                                                                                     | significant  | Tauri FS "planned" (it's wired); OPFS "not wired" (it is); four implementations not three; Tauri not run against the contract                                                                                                                                                                                                                                                      |
| `recovery.md`                                                                                                                                                                                                    | significant  | per-row Keep/Discard is now one card with Restore all/Discard all; `SaveCoordinator.adopt` before replay                                                                                                                                                                                                                                                                           |
| `desktop.md`                                                                                                                                                                                                     | significant  | `corpus_*` commands; placeholder pubkey (real now); "no updater worker" (exists); `-rc` tag; `$TEMP` scope                                                                                                                                                                                                                                                                         |
| `boundaries.md`                                                                                                                                                                                                  | significant  | core inventory lists 6 modules (~27 now); oxc-parser not TS API; `vendorDirs` exception gone; `src/dev` rules missing                                                                                                                                                                                                                                                              |
| release-channels skill                                                                                                                                                                                           | significant  | web custom-domain routes are live; dev runs check+deadcode+browser; pre-flight missing `deadcode`/`lint:release`                                                                                                                                                                                                                                                                   |
| `review.md`                                                                                                                                                                                                      | minor        | "there is no second diff" overclaims (line diff live in History); `recorded.ts` path; `plan`/`decide` removed **WT**                                                                                                                                                                                                                                                               |
| `findings.md`                                                                                                                                                                                                    | minor        | event names `book.analyze`/`corpus.publish`; `applyAll` gone; native thread gone                                                                                                                                                                                                                                                                                                   |
| `host.md`                                                                                                                                                                                                        | minor        | Web credentials are localStorage keyed by origin, not session keyed by name; 6 vs 7 count                                                                                                                                                                                                                                                                                          |
| `editor.md`, `glossary.md`, `configuration.md`, `design.md`, `verification.md`, `README.md`, `source.md`, `project.md`, `solid.md`, `ui.md`, `inventory.md`, `landing.md`, `testing.md`, `diff-and-multibook.md` | minor        | path/name fixes. Notable: `verification.md:100` broken link; `configuration.md` "env.ts is the only reader of import.meta.env" is false (4 other readers); `design.md` says mode `design` (it's `dev`); `inventory.md:76` `sitesOfGlyph` is gone; `README.md:26` Replace wording                                                                                                   |
| `git.md`, designer-setup, design-surface skill                                                                                                                                                                   | fresh        | design-surface skill has `localhost:3210` → 3000                                                                                                                                                                                                                                                                                                                                   |

**Systemic causes**

- The 09-17 route move under `_app/project/$slug/` left flat paths in four docs.
- The native-corpus deletion (761a92e) left IPC/`corpus_*` references in five docs.
- The fixture path, the observability shape and the preview tag are each wrong the same way in several docs.

**Duplicates to collapse**

- EOL/BOM (source.md is the owner)
- Journal mechanics (recovery.md is the owner)
- stage/classify/commit (resources.md is the owner)
- The design switch (design.md is the owner; AGENTS.md shrinks to one line)

## 5. Code comments

Comment density is about 27%. There are two speeds. The ported editor core and the fileSystem module run at roughly 0–2% comments. `app/**`, `core/{sync,compare,search,diff,galley}` and `dev/**` run at 45–68%, and most of the rot is there.

| pattern                                                                                     | count                    | action                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wrong/misleading claims                                                                     | 18                       | fix now. Examples: `debounce.ts` cites autosave; `ProjectContext.tsx:127` says "nothing calls noteWritten" (ReviewPanel does); `recovery.ts:25` says appData "when that service lands" (it has); `findProjected` is named but doesn't exist; `tauri/corpus.ts` citations; `Toolbar.tsx:303` says match formatting "needs Onion first"; `search.ts:14` says "no Replace All" (it exists behind Advanced) |
| Wrong in-repo paths                                                                         | 7                        | fix                                                                                                                                                                                                                                                                                                                                                                                                     |
| Planning citations: vision §, seams §, editor-and-save §, slice N, gap list / engine-asks N | about 90                 | these die with the planning deletes. Repoint to the architecture doc, or drop them. There is no vision doc in the repo at all.                                                                                                                                                                                                                                                                          |
| History narration ("used to…", "was…")                                                      | about 60                 | cut each to the present-tense reason                                                                                                                                                                                                                                                                                                                                                                    |
| Dated rulings ("Will, 2026-09-15: …")                                                       | 9                        | keep the rule, drop the attribution                                                                                                                                                                                                                                                                                                                                                                     |
| "Onion" in Sefer prose                                                                      | about 30                 | say "the engine's"; keep it only for the wire/crate name                                                                                                                                                                                                                                                                                                                                                |
| "vendored"                                                                                  | about 12                 | say "the pinned build". One of these is a user-visible refusal string (`galley/diff.ts:243`).                                                                                                                                                                                                                                                                                                           |
| "Save & Review"                                                                             | 7 comments, 6 UI strings | pick the product name once, then sweep                                                                                                                                                                                                                                                                                                                                                                  |
| 40–80 line headers duplicating an architecture doc                                          | 8                        | ReviewPanel, find/terms, saveCoordinator, galley.ts, projectAnalysis, RecoveryBanner, VirtualList, sync/state. Cut to one paragraph of why plus a link.                                                                                                                                                                                                                                                 |
| TODO                                                                                        | 12                       | 11 are valid; `services.ts:84` points at the wrong file                                                                                                                                                                                                                                                                                                                                                 |
| Commented-out code                                                                          | 0                        | —                                                                                                                                                                                                                                                                                                                                                                                                       |

## 6. Decisions only you can make

1. **Observability.** Which level set is right, and what does production default to? The doc says `error/info/debug/trace` with `info`; the code has `off/verdicts/spans/all` with `all`.
2. **History diff baseline.** Should History diff against the last commit (your memory note) or against the disk/save baseline (review.md's argument)? Under explicit-only save these may be the same thing, so maybe one sentence settles it.
3. **The product name for "Save & Review" / "Record a version"** in UI copy.
4. **Drafting stub:** keep it as an idea, or delete `drafting.ts`?
5. **`configuration.md`'s "one reader of `import.meta.env`" rule:** enforce it by routing the OTLP/log/stream vars through `env.ts`, or scope the rule to network endpoints?

## 7. Suggested order

1. Fix the §0 bugs 1, 2 and 5; they're small. Record 3, 4 and 6 in the one-pagers.
2. Write `documentation/services.md` and fill `INVARIANTS.md` from the salvage list. Move the principle docs and design-direction.
3. Repoint the inbound links, then delete the §1 delete list. What's left in `planning/` should be the "Keep, open" table only.
4. Doc rot pass, worst first: AGENTS.md, search, galley, observability, shell, sync, stet, storage, recovery, desktop, boundaries.
5. Code-comment sweep. Do it after fallow finishes and after the planning deletes, so all ~90 planning citations are handled in one pass. Re-run the backticked-identifier check then.
