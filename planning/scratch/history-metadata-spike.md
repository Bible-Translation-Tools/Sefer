# History metadata spike

Status: bounded scratch result; no production behavior changed.

## Corpus and acquisition

Repository: `https://content.bibletranslationtools.org/Staging/en_ulb_2027.git` (public access confirmed with `git ls-remote`; advertised `master` and `ULB_Revision_2026`). Git transport worked after sandbox network access was granted.

The user-reported 11,998 commits is exactly `git rev-list --count master` for the fetched `master` graph. To avoid fetching every historical text, acquisition used a depth-200 partial clone with `--filter=blob:none`, then `git fetch --unshallow --filter=blob:none origin master`. The first clone reported 408 commits because its shallow boundary follows merged parent paths. Full commit/tree metadata occupied 4.88 MiB. The Genesis path has 156 commits. Only the two blobs needed for one adjacent comparison were then fetched; the object pack grew to 5.00 MiB. The two USFM files were 204,806 and 204,802 UTF-8 bytes.

Exact acquisition/count commands:

```sh
git ls-remote --heads https://content.bibletranslationtools.org/Staging/en_ulb_2027.git
git clone --filter=blob:none --depth=200 --no-checkout https://content.bibletranslationtools.org/Staging/en_ulb_2027.git /private/tmp/en_ulb_2027-history-spike
git fetch --unshallow --filter=blob:none origin master
git rev-list --count master
git log --format='%H' master -- 01-GEN.usfm
git show 360d819ba2cacce124f415a02fb6fb19a0515ea6:01-GEN.usfm > /private/tmp/gen-current.usfm
git show 19f5b1fa58ce4d672926a20ec0ed637747101743:01-GEN.usfm > /private/tmp/gen-previous.usfm
git count-objects -vH
```

## Existing primitives and gaps

- `Git.log(repo, path)` already uses isomorphic-git's `filepath` history filter. It returns a fully materialized array and has no depth/cursor/stream option. `previousVersions(repo, path)` maps that entire array to versions with lazy blob readers. `show(repo, rev, path)` resolves and reads one blob.
- `changedPathsBetween(repo, from, to)` compares tree-entry object IDs and does not need blob reads. This is useful for book path changes but is pairwise, not a history iterator.
- `diffSkeleton(galley, book, before, after)` invokes the current Galley decision-unit diff and keeps an LRU of four pairs. Cache keys contain both full texts; the limit is entries, not bytes.
- Galley already parses USFM into chapter/verse TOC data and the diff units already carry address/status data. No extra chapter diff primitive was needed for this sample. Existing `core/compare` is a line-based whole-book diff, while Galley provides scripture decision units with chapter/verse addresses.
- Missing for a product flow: bounded/streaming path history, a cheap “previous book-changing frame” iterator contract, and a deliberate memory policy for historical text. The spike did not alter these APIs.

## Measurements

Machine/runtime: macOS arm64, Node v24.4.1; `@wycliffeassociates/scripture-kitchen` v0.1.7 / current worktree package pin. These are local native Git and Node/Vitest measurements, not OPFS/isomorphic-git/browser performance claims.

| Operation                                                     |                  Result |
| ------------------------------------------------------------- | ----------------------: |
| Native `git log master -- 01-GEN.usfm`                        |    156 entries; 0.109 s |
| Native `git log master`                                       | 11,998 entries; 0.166 s |
| Full commit/tree object pack, blobs excluded                  |                4.88 MiB |
| Object pack after fetching just the two comparison blobs      |                5.00 MiB |
| Read the two local USFM files in probe process                |                 10.5 ms |
| Galley updates plus TOC reads for both texts                  |                 14.5 ms |
| Galley decision-unit diff                                     |                 17.4 ms |
| Probe start through first scoped result (files already local) |                 54.6 ms |

The selected adjacent Genesis path-changing commits are `19f5b1f` (2025-09-15, “remove spaces before \\f”) and `360d819` (2025-09-16, “spacing around \\fqa*”). Galley reported 1,584 decision units, 2 modified units, in chapters 10 and 31, at `10:4` and `31:25`. Both TOCs reported 50 chapters and 1,533 verse anchors.

## Memory observations

Both decoded texts were held simultaneously for the comparison: 409,480 JS UTF-16 code units (~0.78 MiB at two bytes per code unit), plus the current TOC and diff result. In the Vitest worker, RSS was 126.9 MB after the two Galley updates/TOCs and 159.1 MB after diff; heap rose from 34.1 MB to 37.8 MB and external memory from 10.2 MB to 13.0 MB. `maxRSS` was 155,440 KiB. This includes Node, Vitest, the loaded WASM engine and buffers; it is not an isolated allocation measurement for TOC or diff. The Git object store was on disk in a separate process and therefore is not included in those RSS figures. No list of historical decoded books was held.

The four-entry `diffSkeleton` cache can retain up to four text pairs and their skeletons. For a history browser that steps through many revisions, this is bounded by count but may still retain roughly eight full book strings plus derived results. Calling the Galley diff directly or adding a byte-aware history cache would be a separate design decision; this spike did not tune the shared cache.

## Time-to-first-frame interpretation and limitations

With metadata and both selected blobs already local, the measured probe returned the first useful scope in about 55 ms. The native Git path walk itself was about 109 ms for 156 Genesis changes; the all-history walk was 166 ms. Fetching the two blobs over the remote took about 3.8 s in the one observed command, but network transfer is separate from the cached/local read and was not repeatedly measured. Fetching the remaining commit/tree metadata after the initial shallow clone took about 13.3 s and transferred roughly 4.7 MiB; do not include this one-time setup in per-step latency.

The measurements do not predict isomorphic-git cost on Sefer's `effect/FileSystem`/OPFS view, browser heap behavior, or a cold remote sync. Native Git is optimized C with a local pack; Sefer's current Web port materializes the complete `git.log` result. The real corpus sample also covers only Genesis and two consecutive file-changing revisions. An integrated browser/OPFS profile should measure cold/warm object reads, returned-history allocation, and stepping latency before adopting retention policy.

## Scratch probe

`tools/history-metadata-probe.test.ts` is the one-off runner. It was run with:

```sh
pnpm install --offline --frozen-lockfile
pnpm exec vitest run --project core tools/history-metadata-probe.test.ts
```

The focused probe passed. Its JSON result was written to `/private/tmp/history-spike-result.json` for transcription. The offline install added no downloaded packages; all 477 packages came from the local pnpm store. Nothing was committed or pushed.

## Browser / OPFS follow-up

The initial direct browser request to the content host returned HTTP 403. Sefer's Web remote deliberately rewrites that origin through the configured transport and adds `X-Requested-With: sefer-local` in the dev build. The bounded rerun used that same `parseTransport` / `through` mapping and header with direct isomorphic-git HTTP over the real `OpfsFileSystemLive` adapter. This is the transport/library path, not the full `WebRemoteLive` or `WebGitLive` composition. `.env` was loaded into the test process without printing its values.

The browser test requested `depth: 10`, `master`, single branch, no tags, and no checkout. Browser: HeadlessChrome 153.0.8010.12, macOS arm64; this was Vitest Browser Mode. The actual reachable graph had 33 commits because ancestry merges widen the shallow boundary. OPFS usage moved from 0 to 1,541,320 bytes; recursively counted repository `.git` files totaled 1,537,972 bytes. `git.clone` took 1,313.7 ms. This is an observed proxy fetch plus pack indexing/write run, not a timing for the original unproxied 403.

| Browser/OPFS operation                                                     |                                         Result |
| -------------------------------------------------------------------------- | ---------------------------------------------: |
| Reachable commits from depth-10 request                                    |                                             33 |
| OPFS repo bytes / browser storage usage delta                              |                    1,537,972 / 1,541,320 bytes |
| Clone elapsed                                                              |                                     1,313.7 ms |
| `git.log` path history for Genesis in shallow graph                        |                            4 entries; 102.8 ms |
| Cold `readBlob` current / previous                                         |                                 11.1 / 11.6 ms |
| Repeated current `readBlob`                                                |                                        11.4 ms |
| Galley update + both TOC reads                                             |                      10.1 ms; 50 chapters each |
| Galley diff                                                                | 14.4 ms; two changed units, ch. 10:4 and 31:25 |
| First paired scope after clone began (probe also preloaded one older blob) |                                       1,555 ms |
| One previous-frame step (read + Galley + scope)                            |                       11.8 ms; 3 changed units |
| Long task observed                                                         |                                         222 ms |

The four path entries are a consequence of the shallow commit boundary, not the repository's full 156 Genesis revisions. Native Git's unshallowed path history remains the measurement for full history traversal. Chromium exposed `performance.memory` at 39.6 MB before/after; the sampled values did not change, which does not prove there was no growth or retained allocation. Forced GC was unavailable. Galley's `dispose()` calls the WASM handle's `free()`, and `WebGalleyLive` registers it as a scoped finalizer; this probe exits that Galley scope, but did not instrument WASM allocation bytes. The OPFS temp directory is removed by `makeTempDirectoryScoped` when the probe scope exits; the measured storage delta was before cleanup. Browser resource timing reported zero transfer sizes for the proxy Git requests; exact wire bytes were therefore not measurable in this run. OPFS bytes are measured on disk and should not be called network bytes. No historical-book collection was retained; the probe held only the selected three Genesis blobs/texts for the two displayed frame comparisons. The WASM asset loaded separately and is not part of the reported Git object bytes.

The browser numbers above are from one successful measurement run; there was no repeated browser sample. Exact command, with the main checkout's environment loaded silently so the worktree test sees the configured transport mapping:

```sh
set -a
. /Users/willkelly/Documents/Work/Code/Sefer/.env
set +a
pnpm exec vitest run --project browser src/platform/web/history-spike.browser.test.ts
```

## Reusable pure scope primitive

Scratch-only `src/core/history/delta.ts` exports `deriveDeltaScope(beforeText, afterText, skeleton)`. It projects Galley's already-computed `DiffSkeleton` into changed decision-unit facts, affected books, and chapter occurrences with full address SIDs. It has no Git, transport, author, UI, or review-policy dependency, so the same shape can support local Review, History, zip, or future remote callers. Callers must provide the exact strings used to create the skeleton; the primitive checks lengths but cannot detect stale equal-length content. Tests cover bridges, verse duplicates, repeated chapter occurrences, moved units on both sides, structure-only changes, front matter versus chapter-open at chapter 0, unchanged filtering, and length mismatch.

`ChapterChangeScope.refs` contains SIDs, not a verse count: chapter-open and front-matter SIDs may appear there, and verse bridges/duplicate suffixes remain intact. Galley's addresses are accepted as-is; this projection does not invent mapping for missing or duplicate addresses. The current `Addr` carries chapter occurrence (`cdup`) and verse occurrence (`vdup`) but this API groups at chapter occurrence and preserves the full SID for verse-level distinction.

Focused verification in the scratch worktree: `pnpm exec vitest run --project core src/core/history/delta.test.ts` passed (2 tests), `pnpm typecheck` passed, and the bounded Browser Mode OPFS test passed. The browser probe's only non-passing run was the deliberate temporary metrics extraction throw; the run completed its measurements before that throw. No browser clone of all 11,998 commits was attempted.

## Timeline prototype, verified 2026-09-25

Verified with the CDP rig (`pnpm verify:chrome`, headless) at `http://127.0.0.1:3001/playground/history-diff`, over `WycliffeAssociates/en_ulb` imported through the product's Clone door into the rig profile (full single-branch clone, 9.0 s, not shallow).

**Why Genesis showed no history.** `Git.log(repo, "01-GEN.usfm")` on the Web port threw `GitError` — isomorphic-git 1.42.2 `UnsafeFilepathError` on `00-About_the_ULB\ULB-Intro.md`, a tree entry name in the 2018 commits `f030471a`..`486f0065`. `_log` rethrows anything but `NotFoundError`, so `force`, `follow`, `depth` and `since` do not help; `readBlob` with a `filepath` fails the same way on those commits. The page then printed "no recorded versions" because it showed `cause.message`, which is empty on a `GitError`; it now uses `#app/describe`. The path passed was the correct repository-relative `01-GEN.usfm`.

**The walk.** `src/dev/playground/bookHistory.ts` is an async generator: newest-first commit walk, git's default history simplification (a merge TREESAME to a parent follows only that parent), trees read as raw object content with only the path's entries parsed, blobs read by id. Against a native clone it returns the same 156 commits in the same order as `git log -- 01-GEN.usfm`. It yields as it goes; the page pulls in batches of 8 as the view nears the left, so nothing needs the total up front. The total is only known at the end: proving there is nothing older than the 2017-06-23 unification commit walks 8,878 commits (~9 s after the last change is found; ~40 s from a cold link to the oldest change).

**The selector.** It populates on a fresh load. The empty selector seen earlier was two things: the rig's OPFS for this origin was empty until the import, and the dev server's watcher had stopped serving edits to this file (twice this session — `curl` the module and grep for a new symbol before trusting a browser result; restart `pnpm dev` if stale).

**Measured (headless Chrome 153, dev server, 1280×900):** first slide ready 286–379 ms after choosing Genesis; 154 consecutive Earlier steps, one slide each, p50 239 ms / p90 278 ms click-to-ready (includes ~200 ms smooth scroll); zero samples in which a slide that had its comparison lost it; heap 91–161 MB across runs (whole app, dev build). A 3,033-line CRLF→LF commit (`a743b33c`) compares as LF and says so.

**Bugs found on the way:** Chrome re-snaps a `snap-mandatory` strip when children are appended mid-smooth-scroll (fixed: commits are published after 150 ms without a scroll event, and the sentinel is not a snap point); a pull that copied the published list after a deferred publish dropped commits the generator had already yielded (fixed: one `found` array is the source of truth).

**Link state.** `?project=&book=&at=<12-char id>&remote=<origin, credentials stripped>` follows the slide in the middle (replace, not push). Opening a link walks back to `at`. A link for a project this browser lacks names it and its remote. Not verified: the message for an `at` that is not in the book's history (it needs the full ~40 s walk to prove absence).

**Not done:** the walk runs on the main thread (async, but each OPFS read is a task); all-books-in-one-walk (every book is a root-tree entry, so one walk could report which books each commit changed at about the cost of one); arbitrary two-point comparisons in the URL (`at` names one adjacent pair).

**Galley per card (2026-09-25):** the page parsed each text three times — `analyze` twice for header chapter counts, then `diff`. Counts now come from the diff's per-side unit addresses (distinct chapter occurrences), so a card is one engine call. Genesis, Chrome, 8 held cards: p50 8.6 ms → 5.5 ms (p90 9.0 → 5.9); the first card of a page is ~16 ms while the WASM warms. The old TOC count said 51 for Genesis (it counted a non-chapter row); the unit count says 50.

**All-books index (2026-09-25, scratch `src/dev/playground/bookIndex.ts`):** 11,998 commits in 4.0 s over the in-memory pack view; per-parent book changes (6,637 entries); JSON 2.5 MB / 0.70 MB gzip / ~0.78 MB compact binary; parse 4 ms; Genesis from the index 2.9 ms and equal to native; every book 116 ms (68 paths, 6,006 entries); two-point "books changed" 42 ms. Gitea API: fast per path, but a full index would be 240 uncompressed pages (~2 min, ~32 MB) with no blob ids, and raw file endpoints are Cloudflare-challenged.

## Prototype pieces you can drive (2026-09-26)

Built on `/playground/history-diff`, all under `src/dev/playground/history/`, every step traced in the app's ring (`__sefer.observability.traces.recent()`, names `history.*`).

- **Pack-cached view** (`packView.ts`, plan primitive 1). Pack files in memory; loose-object probes from one listing; every other read under `objects/` and the `stat` of `.git` answered once. The `.git` stat was the hidden one: isomorphic-git stats it on every command, 47,959 times in one build — 30 s of the 31. With it remembered, a whole index build makes **10 filesystem calls** (2 readdir, 7 readFile, 1 stat).
- **Book-change index** (`bookIndex.ts`, primitive 3, plus 5a and 6a/6c). Per commit: parents, time, author, subject, per-parent book changes. `buildBookIndex` reuses a previous index commit by commit, so one walk covers extend (after a fetch) and rebuild (after a force-push); commits read at a shallow boundary are re-read once their parents exist. `bookHistoryFrom` (git's simplification), `mergeBase`, `booksChangedBetween`, `blobAt`.
- **Built in a worker** (`indexWorker.ts`), reading under a shared Web Lock `sefer.git:<root>` (the app's writers do not take the exclusive lock yet), **stored** at `/sefer/history/<root>.json` (outside the project), ensured by `indexStore.ts` as one operation `history.index.ensure` with `load`, `tip`, `build` (worker timings and fs call counts as attributes) and `save` spans.
- **The page** opens a book from the index when it has one (`history.book.open`, `source: index`) and walks otherwise (`source: walk`); each slide says which other books the commit changed; a merge slide gets its facts (`history.merge.facts`): common ancestor, books changed on each side and on both, and for the book on screen the passages changed on both sides (Galley from the ancestor to each parent, intersected by reference).

Measured on en_ulb (11,998 commits), Chrome via the CDP rig, dev server:

| Step                                                     |                                            Time |
| -------------------------------------------------------- | ----------------------------------------------: |
| Index build in the worker, cold                          |   4.9 s (walk 4.76 s, pack load 18 ms, 16.1 MB) |
| Index build before the `.git` stat was remembered        |                                          30.6 s |
| Index extend, 49 new commits                             |             391 ms (walk 100 ms; 11,949 reused) |
| Index open, stored (2.76 MB)                             |           29–38 ms (load 15–30 ms, tip 8–14 ms) |
| Book open from the index (Genesis, 156 changes)          |                                           19 ms |
| First slide with no index (walker, page load included)   |                1.4 s (first two changes 110 ms) |
| Merge facts, 2 Samuel `e17df4f2` (base, books, passages) | 497–527 ms (base 1 ms, books 259, passages 267) |

**Drive it:** open `/playground/history-diff?project=en_ulb&book=01-GEN.usfm` (the first open builds the index in the background, ~5 s, and says so beside the book picker; the next open is from storage). A merge with facts: `?project=en_ulb&book=10-2SA.usfm&at=e17df4f2c220`. To force a rebuild, delete `/sefer/history/` in OPFS.

**Not built:** shallow clone then deepen in the worker (needs the web transport in a worker, and the exclusive lock on the app's writers); an own pack reader (primitive 6); the index covering fetched remote branches (it indexes `HEAD`); a two-points picker in the UI (the function exists).

**Tests:** `src/core/history/*.test.ts`, `src/platform/web/history-spike.browser.test.ts` and `tools/history-metadata-probe.test.ts` came with the spike and are NOT committed; master's no-tests rule applies when any of this moves there.
