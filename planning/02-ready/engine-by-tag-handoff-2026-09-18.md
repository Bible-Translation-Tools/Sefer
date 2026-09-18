# Handoff — the engine is a tagged dependency, and what that unlocks

Written 2026-09-18, mid-session, because work moves to another repo. Everything
in the first section is **done and green** (`pnpm check`: 113 tests, boundaries
clean, build passes). Everything in the last section is **not started**.

---

## 1. Done: `vendor/` is gone

`vendor/galley/` is deleted. The engine is now:

```json
"@wycliffeassociates/scripture-kitchen": "github:WycliffeAssociates/scripture-kitchen#v0.1.4"
```

pnpm honours the package's `files` field, so the install is **3.9 MB** — the
readers, the two wasm builds, `diagnostics.json`. No `corpora/`, no
`testData/`, no `target/`. The repo has no `scripts`, so there is no build step
on install; the committed `pkg-web/` is what gets used, which is the same thing
the vendor copy was.

### What moved

| was | is |
| --- | --- |
| `vendor/galley/onion-reader` | `…/scripture-kitchen/reader` |
| `vendor/galley/sous-reader` | `…/scripture-kitchen/sous-reader` |
| `vendor/galley/toc-reader` · `find-reader` · `mask-reader` | `…/toc-reader` · `/find-reader` · `/mask-reader` |
| `vendor/galley/pkg-web/usfm_galley.js` | `…/scripture-kitchen/web` |
| `vendor/galley/pkg-web/usfm_galley_bg.wasm?url` | `…/scripture-kitchen/web/wasm?url` |
| node: `new URL("../../../vendor/…")` | `import.meta.resolve("…/web/wasm")` |

Both hosts now ask the *resolver* where the bytes are instead of spelling a
path, so Web and Node cannot drift onto different artifacts.

### What was DELETED rather than ported

- **`vendor/galley/manifest.json`** — and with it `EngineManifest` and
  `accepts()`. Its whole job was catching "the wasm was re-copied but the
  reader was not." A tagged dependency moves as one unit, so that state is not
  reachable and the check could only ever agree with itself.
- **`EngineVersion.revision`** — the commit a tag resolves to lives in
  `pnpm-lock.yaml`, which is where a dependency's identity belongs. A copy of
  it here is the second record this change exists to remove.
- `tsconfig.json`'s `"vendor"` include, `oxlint.config.ts`'s vendor ignore, and
  the boundaries checker's `vendorDirs` entry. The checker's `vendorDirs`
  *option* stays (three lines, and the next vendored thing will want it) but
  has no callers — core reaches the engine by bare specifier now, which the
  existing rule already permits.

`VersionMismatch` **survives**: it is also the runtime guard `decodeHits`
throws on a bad FIND header, which is about bytes crossing the wall and has
nothing to do with vendoring.

### The one new piece of machinery

`__GALLEY_TAG__`, a Vite `define` in `vite.config.ts` that reads the dependency
spec out of `package.json` and slices off the `#tag`. It exists so the boot
note can still say which engine a build resolved:

```
opfs galley usfm_galley v0.1.4
```

It reads the single pin rather than restating it. A spec with no `#` (a branch,
a `link:`) reports itself verbatim, which is honest for a build that is not on
a release. Declared in `src/vite-env.d.ts` beside `__SEFER_BUILD__`.

`engineVersion()` now reports the four format versions from the **readers' own
constants**, so it cannot claim a wire the installed package does not speak.
That is strictly stronger than what `accepts()` checked.

### Why this was worth doing now

v0.1.2 → v0.1.4 is wire-identical (onion 4, sous/find/toc/mask all 1, every
magic unchanged), so the bump was free. Checked at each tag before moving.

---

## 2. The thing this unlocks

**v0.1.3 shipped the §4.2 dish-range helpers** (`planning/plans/diff-runs-dish-queries.md`
upstream). Sefer was on v0.1.2 and had none of them. On v0.1.4 they are in
`onion-wasm/reader.ts` at lines 1391–1481:

```ts
tokenAt(offset): number
enclosing(from, to): { node, token, marker, from, to }
spansIn(from, to): { from, to, kind, marker }[]
inMarkup(from, to): boolean
```

`enclosing()` is the one that matters for the queued work. Upstream §4.3 says
it directly: *"Is this a paragraph, is this poetry": `MARKERS[enclosing(...).marker]`*.
Sefer answers that today with `blockAt()` in `core/kernel.ts`, a linear scan
over the block table. `enclosing()` is a binary search plus a parent walk, and
it also answers the level `blockAt` cannot — which **character** marker the
caret is inside.

Nothing in Sefer calls these yet.

---

## 3. Not started — the queued work, in order

### 3a. Selection signal (~15 lines)

`BookEditor` installs an `EditorView.updateListener` that fires on
`update.selectionSet` and writes `view.state.selection.main.head` to a shell
signal. It does not exist because nothing needed it, not because it is hard.
`ReferencePane`'s header already names it as the blocker for verse-level sync:

> the shell has no reactive signal for a selection — `book.changes` fires on
> document changes only. Adding one means a selection listener in `BookEditor`.

Three separate features are waiting on this one signal.

### 3b. Scripture breadcrumb

Beside `data-testid="location-previous"` in `LocationBar.tsx`. Always visible
(Will's call — it is a dev sanity read while testing, not a user feature), and
it should say **both** the block path and the BCV:

```
Psalm 1:1 › Poetry 1 › Poetry 2
```

Plural on purpose: a caret in a `\q2` continuation is in Poetry 2 *and* inside
verse 1, which opened back in a `\q`. Names come from
`src/app/ui/workspace/blockNames.ts` (already written, English, TODO to
localize) through the `blockNamer` facet. The char-marker crumb (`› add`) is
where `enclosing()` earns its place — `blockAt` cannot answer it.

### 3c. `highlightPairedBlock()`

"What is that `\q2` in the source text." Upstream `overlay.ts` already specs
the architecture in its own header, and it is not the obvious one:

> Fetch `skeleton()` for both sides ONCE per edit (~0.4 ms each) and match
> addresses in TypeScript as the cursor moves. `targetNodeFor`/`sourceNodeFor`
> are ~1.4 ms and are for one-off questions — not for a per-keystroke loop.

Match on `BlockAddress` `{sid, where, ordinal, marker}`, where `marker` is a
**check and not the key** — position is the key, and a stale marker throws by
design rather than answering about a different block. Needs 3a.

---

## 4. Open, not chased

- **Prev/next chapter is wrong.** Reported: "up works but jumps two chapters."
  That is `at()` in `LocationBar.tsx` reading a **lagging** `atTop`, not a
  stuck one — stepping back from a stale reading lands two away. My earlier
  guess (stuck at ordinal 0 → Previous disabled) was wrong; the symptom rules
  it out. Suspects: `chapterAtTop`'s probe point (`box.left + 8, box.top + 2`
  against two very different `.cm-content` geometries), or a race between
  `scrollIntoView` and the scroll listener. Not investigated.
- **Overlay inserts arrive in reverse source order.** Written up at
  `scripture-kitchen/planning/ideas/other_repos/sefer-overlay-insert-order.md`.
  **Observed against v0.1.2, which Sefer is no longer on** — re-run the case in
  that file on v0.1.4 before acting on it, and delete the file if it is fixed.
- **Nothing in this session has been opened in a browser.** The empty-block
  ghost's `side: 1` (the caret must land *before* the label) is the specific
  thing no headless test covers.
