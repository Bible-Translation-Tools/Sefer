# Resource kinds: shared domain ideas, not four apps in one

**Status:** discussed, not authorized, 2026-10-01 to 02. This file replaces `00-ideas/resource-kinds.md` (first pass 2026-09-24, second 2026-09-25, third 2026-10-01) and `01-discussing/web-translation-notes-import.md` (2026-09-19); both are deleted and their substance is here. The visual plan review that was built alongside is [resource-kinds-plan-review.html](resource-kinds-plan-review.html) in this folder. Sources: Will's voice memos and the 2026-10-01 conversation, a read of today's code, the Macula package in `~/Downloads/clearBibleSyntaxTree/packages/macula-js`, the canonical WACS repositories, the rc0.2 spec, and one measured OPFS spike.

Related chapters: Library and metadata (`documentation/architecture/resources.md`), Location (`documentation/architecture/location.md`), Findings, Review, the excerpt card.

## 1. The job, and the fear

Sefer will hold things that are not scripture text: Macula's Hebrew and Greek syntax trees, Translation Notes (TN), Questions (TQ), Words (TW), and whatever comes after. People are revising our source texts now, so Macula is not hypothetical. Nobody has asked for TN or TW to be editable; Will wants what the app can do with a thing to be strongly typed so that a new capability plugs in later.

The fear is building four applications into one. The real unease, worked through, is this: a tier-3 idea (USFM) living in a tier-1 module (text), so that every new kind has to route around scripture assumptions that have nothing to do with it. The remedy is to name the tiers and let a module depend downward only.

### What presupposes USFM today

One chain: `/project/$slug` opens a Project, a Project is a folder of `.usfm` Books, the engine parses them, its TOC gives every Address. `Source`, `Book`, `Address` and the Library are already text-agnostic. The Library keeps a resource's **container kind** (`burrito | resourceContainer | looseUsfm`), its free-text `subject`, and its per-project **role** (`source | reference | notes | glossary | tn | tw | tq`, open) apart, and a `tn` binding can be made that nothing reads (`documentation/services.md`). Resources are not peers of a project and the router does not swap editors; they hang off the Library by role, beside the Project chain, which is left alone.

## 2. Three tiers

| Tier             | Knows                                              | Ideas that live here                                                                                                                                                                                                                                 | Modules today                                                                                                                                  |
| ---------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Text**      | Bytes and a file. Nothing about scripture.         | Source, Book, changes and history, backup journal, explicit save, the Git lifecycle (clone, pull, versions, sync), text find with a per-format mask, line or hunk diff, comments anchored by checksum and offset, where to save, the FileSystem port | `core/source`, `core/book`, `core/save`, `core/recovery`, `core/sync`, Git and FileSystem ports, `core/resources/library.ts` (roots, bindings) |
| **2. Addressed** | Where this is in book, chapter, verse, both ways.  | Address, `places()`, follow the caret, clip to a range, a fragment in a multibuffer, "that verse does not exist", `rc://` links, versification mapping, Macula's faceted find                                                                        | `core/location/address.ts`, `locate.ts` (the TOC half), the renderer registry and panes proposed here, every adapter                           |
| **3. USFM**      | Markers, the engine, everything derived from them. | Engine and overlays, Sous, inventory, STET, sid-aligned decision units, diff for USFM, "surfaces are judged, not trusted"                                                                                                                            | `core/project` (as it opens Books), the editor, `core/compare`, `/review`, `/inventory`, `/terms`, the excerpt card                            |

**The rule.** A module depends downward only: 3 → 2 → 1, never up. Before adding a function, say which tier it is in: it takes text, an Address, or a marker. Eventually a `pnpm boundaries` check; today this table.

**Today's upward leaks**, named so no fifth is added. None is fixed ahead of a kind that needs it; the TN proof surfaces the first two on its own.

1. `core/project/project.ts` opens a root and refuses it without `.usfm` Books (`NoBooks`). A project is a root with documents. To change: split "open a root" (tier 1: documents, Git, journal) from "open its USFM Books" (tier 3); `$slug.tsx` keeps calling the second. One file, one caller.
2. `Library.readBook` is "the bytes of its `.usfm` file". To change: `readText(resourceId, path)` beside it; `readBook` becomes the `usfm` adapter's call. One caller (`ReferencePane.tsx`).
3. `app/workflows/references.ts` filters on `isUsfm`. To change: filter `content === "usfm"` once that field exists. One line.
4. Review's decision unit is sid-shaped; there is no tier-1 diff to fall back to. See §8.

**Macula has tier 2 only.** No files, no Book, no git, nothing USFM. Tier 1 is therefore a capability, not a floor (§9).

## 3. The shape: one closed union, consulted twice

```text
Library (core/resources)   what is registered, where its bytes are, which role it plays in a project
   │ recognize(container, metadata) → ContentKind + reader     ← place one
   ▼
Kind table                 ContentKind → adapter; open(resource) → ResourceHandle
   ▼
ResourceHandle             info · places? · documents? · search? · edit? · release   — every call an Effect
   ▼
shell.resources (app)      the project's handles by role, opened once in $slug's effect, released with the project
   ▼
Renderer registry (app)    switch (content) → pane · search panel · diff pane             ← place two
```

- **Two fields, two facts.** `ResourceKind` is renamed `ContainerKind` (`burrito | resourceContainer | looseUsfm | builtin`); a new closed `ContentKind = "usfm" | "tn" | "tq" | "tw" | "macula-greek" | "macula-hebrew"` is set by `recognize()` in `Library.add`. The rename goes first and alone: six files import the old name and `library.json` persists it. The plan's earlier use of "kind" for the content union collided with it.
- **Between the two places nobody discriminates.** Panes check for a slot (`handle.search !== undefined`), never for a kind. A grep gate in the style of `dev-only-routes.md` can hold the rule: `ContentKind` is narrowed only in `recognize.ts` and `registry.tsx`.
- **Closed, not a registry.** Every kind is built in. An open registry pays only for third-party kinds nobody has asked for. "Plugin" is retired; a supported resource is a kind and the code answering for it is its adapter.
- **Address is the only edge.** A pane owns its DOM and speaks to the rest of the app in `Address`. Sefer's emitter is already `src/app/shellEvent.ts`, a closed union of eight variants, deliberately narrow. The choice is a `place.focus { address, from }` variant (then `booksOf()` needs a third answer for a variant that moves no Book) or a separate `shell.place` signal. Will's call. Either way a pane ignores its own `from`, filtered once centrally.
- **Every call an Effect, consumed by a Solid 2 async memo.** The real reasons, not "remote resources": one colour, interruption when the caret moves on, a typed `unavailable`. Location stays synchronous; the two meet at the Address.
- **`Held`, the pending policy as a primitive.** Hold the last answer, never dim, fall back to `DelayedSpinner` (exists) after an elapsed time. The only way a pane consumes a handle, stated in `ui.md`'s primitive inventory, or panes flicker differently and the "feels synchronous" property dies by a thousand cuts.
- **Adapters placed by what they import.** Markdown and TSV readers in `src/core/resources/kinds/` over `effect/FileSystem`; Macula in `src/platform/*/macula.ts` because it fetches and initialises wasm, which `pnpm boundaries` keeps out of core.
- **Typed, not built.** `edit` on TN/TW is typed and has no implementation. `pnpm deadcode` (fallow, run by `release.yml`) fails on an unused type, so the slot needs one consumer (the registry choosing read-only when `edit` is absent) or a documented `.fallowrc.jsonc` entry per `lint-results.md`.

## 4. Containers, formats, readers

### Manifests decide the kind and the reader; bytes are only ever checked

| Decision                      | Resource Container `manifest.yaml`                                                                | Scripture Burrito `metadata.json`                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Kind                          | `dublin_core.type` (`book · help · dict · man · bundle`) + `identifier` (`tn`, `tq`, `tw`, `ulb`) | `type.flavorType.name` + `flavor.name`; notes would be an `x-` flavour the kind table knows |
| Reader (format)               | `dublin_core.format`, one MIME type per resource                                                  | `ingredients[path].mimeType`, per file                                                      |
| Where the files are           | `projects[].path` + `identifier`, one project per book                                            | `ingredients` keys + `scope` (`{ GEN: ["1","2"] }`)                                         |
| Versification (tier 2)        | `projects[].versification`, per book                                                              | a `peripheral/versification` ingredient                                                     |
| Which text it quotes (tier 2) | `dublin_core.relation` (`en/ulb`)                                                                 | `relationships[]`                                                                           |

Both schemas are decoded in `core/resources/` today; `relation` and `relationships` are dropped and are the fields to start keeping.

**Spec versus convention** (checked against rc0.2's container-types page). The spec ties **layout to `type`**, not to the MIME type: a `help` is "structured in the same way as a book", chapter directories of numbered chunk files with `title.md`, `intro.md`, `front/`, `back/`, helps split by Markdown headings, "all help RCs must use the markdown format"; a `dict` is one file per term; `man` is article directories; `bundle` is flat, one file per project. **Convention in our ecosystem, not spec:** that a chunk file's number is its first verse and its range closes at the next sibling; TSV as a help format at all (unfoldingWord's extension); the nine- versus seven-column TSV layouts. Burrito exists partly to remove this: `scope` declares coverage per file, so a burrito needs no layout grammar.

**The rule.** `recognize()` reads metadata only and never opens a content file. A reader parses by its one declared grammar and validates as it goes; a mismatch is a refusal or a `Finding`, never a guess, and never a try-the-next-parser cascade. Sniffing is the fallback for the one container with no manifest (today's `looseUsfm`) and a one-line header check inside the TSV reader. Everything that is convention lives in exactly one reader, named for it (`rcHelpMarkdown`, `uwHelpTsv`); the record below is the only thing that crosses out of a reader. Capabilities derive from the kind through the kind table, never from a manifest field.

### A kind plus a reader: normalization

Two things hide under "notes may be stored differently". **Where it lives** is the container's job and already decoded. **What it is** varies by format, not container: WA's `en_tn` is Markdown per chunk, unfoldingWord's `tn` is TSV per book, both the kind `tn`. So `recognize()` returns a kind and a reader, one reader per (kind, type, MIME type), and every reader yields one record:

```ts
interface Note {
  readonly address: Address; // GEN 1:28 · GEN 1:28-29 · GEN 1 intro · GEN intro
  readonly ordinal: number; // position within that address
  readonly body: string; // Markdown, exact
  readonly quote?: string; // WA: the heading; uW: the Quote column
  readonly id?: string; // uW only
}
```

A reader is a pure function from bytes and a declared scope to records, importing nothing but `address.ts`. That is why it belongs in `src/core` and would extract cleanly to a utilities repo later; nothing about Sefer is needed to parse a TN file.

### Worked example: WA `en_tn` and unfoldingWord `tn` are one kind

| Tier 1 question     | WA `en_tn` (`text/markdown`)                                                      | unfoldingWord `en_tn` (`text/tsv`)                                                     |
| ------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `projects[].path`   | `./gen`, a directory                                                              | `./tn_GEN.tsv`, one file                                                               |
| A document          | one chunk file `gen/01/28.md`                                                     | one book file; columns `Reference ID Tags SupportReference Quote Occurrence Note`      |
| Files, whole Bible  | 29,300                                                                            | 66                                                                                     |
| Edit unit           | the chunk file; `Book` opens it as text                                           | the book file; `Book` opens it as text, a row per note                                 |
| Git diff shows      | one file per note changed                                                         | one line per note, in one file                                                         |
| Haystack `Subject`s | one per chunk, or one per packed book                                             | one per book file, as is                                                               |
| Web derived store   | yes: per-book packs, raw tree never materialised                                  | no: 66 files is already the packed shape                                               |
| Address from        | the path, closed at the next sibling; the last chunk of a chapter **needs a TOC** | the `Reference` column: `1:28`, `1:28-29`, `1:intro`, `front:intro`; **no TOC needed** |
| Entry identity      | none upstream (57 repeated headings); the reader synthesises an ordinal           | the four-character `ID`                                                                |

At tier 2 both answer identically from the one record: `places.at` is a lookup, `places.of(note)` is `note.address`, `documents()` hands the default find each body with its Address as id, a fragment is the notes in a range, a pane renders `body` and emits `address` and cannot tell which repository it shows. The difference leaks in two deliberate tier-1 places: the WA reader takes a TOC and refuses `unresolved` without one; and a WA edit touches a 400-byte file where a uW edit touches a line in a 300 KB file, so Review's text diff shows one file or one line. Consolidation upstream is the right column replacing the left: one reader, everything above unchanged. Whether unfoldingWord is ever loaded is beside the point; it is the boundary test.

## 5. Find: a default, one override, and the haystack

Rust's `Default` is the picture: a kind gets tier-1 behaviour for free and overrides only where it has something better.

- **The three stages exist.** `core/search/reading.ts`: a `Subject` (id, text, stamp?) is one haystack unit; a `Reading` is that subject prepared (`toSource(at)`, `pieces(from, to)` for spans across dropped markup); a `Hit` carries its stamp. Scope → prepare → match → map back.
- **USFM overrides one stage.** Its Reading is cut by Galley's mask; Galley owns that lifecycle and keeps it. The default Reading is the identity. A Markdown mask is a cheap second Reading if wanted.
- **The override point is the haystack.** A kind supplies `documents()`: a stream of Subjects. USFM's are Books, a folder's are files, TN's are whatever its adapter hands back. Everything after is shared. Two finds, not N: text find (tier 1, any files, mask per format) and Macula's faceted find (tier 2, its own, self-described). Whether a find spans one file or a root is a loading detail of the handle.

### The 27k-file wrinkle is about the haystack, not find

Three things USFM already keeps apart stay apart for TN: **on-disk layout** is upstream's (git, export, edit unit; never reshaped); the **derived store** is per-book packed JSON, an index rebuilt from disk and stamped, as the engine's TOC is for USFM; the **edit unit** stays the chunk file, and an edit or a pull invalidates that book's pack. `documents()` reads the pack, one book in memory, the next loaded asynchronously on switch. Editability costs nothing.

**Measured** (2026-10-01, headless Chromium, Vitest Browser Mode, median of 3; worktree `.claude/worktrees/agent-ac14bbb61d11e1be8`, rerun `node spike/build-fixtures.mjs && pnpm exec vitest run --project browser src/dev/spike/opfsSpike.browser.test.ts`). Canonical `en_tn` is **29,300 files, 13.98 MB** (the earlier 26,001 / 5.75 MB was `en_tn_condensed`); `en_tq` 17,375 files, 2.76 MB; `en_tw` `bible/` 1,012 articles plus a 1.02 MB `config.yaml`.

| en_tn                                  | time              |
| -------------------------------------- | ----------------- |
| write 29,300 raw files to OPFS         | 22.6 s (~1,300/s) |
| read them all back                     | 10.0 s            |
| delete the raw tree                    | 2.6 s             |
| build and write 73 per-book packs      | 0.14 s            |
| load one pack (Psalms, 1.14 MB)        | 4 ms              |
| load all 73 packs                      | 0.37 s            |
| substring or regex find over all packs | under 20 ms       |

File count dominates and bytes barely register (en_tw's files are 3.5× larger and write at the same rate). Packing is about 200× less OPFS work for identical content. Find over packs needs no index at this scale. `performance.memory` could not see 14 MB move, so memory is unmeasured, not free. No worker was tried because nothing on the main thread was slow enough to justify one. Still unmeasured: Web git over a raw tree (the history spike's `.git` stat cost) and a low-end device.

### The Web import path for TN (from the retired import plan)

- **If we control the distributed resource:** pack once before publication, ideally as a Gitea release beside the repo, and the Web reads one object per book with no tree at all. Keep provenance and a format version.
- **If the input is a raw archive:** decode entries straight into the per-book accumulator and write only the packs. Never extract the tree, copy it, then read it again. A remote ZIP and a browser-selected ZIP feed the same path.
- **Trust boundary, unchanged from the import plan:** identify the resource from decoded metadata, never a filename or a caller's flag; normalise the optional archive root; reject traversal, absolute paths, duplicate names, duplicate book/chapter/verse keys, invalid UTF-8; preserve exact Markdown bodies and never flatten two notes for one verse; write to an unregistered directory, validate every pack reopens, publish to the index only on completion, remove on failure. Keep the raw archive, if at all, as **one** object; it must not become a second mutable source.
- **Decision gate:** direct packing first; a worker only if decode or assembling 29k strings measurably blocks the UI; a format change only for a separate reason. The spike says direct packing removes the long import.

### Release versus writability

An adapter from a packed on-disk layout back to the upstream git layout is the wrong direction; it would make the derived store the source of truth. A release carrying per-book JSON is the clean read-only story, and it kills writability on the Web, which is the real cost of 29k files having been the format instead of SQLite or one file per book. **Rule:** read-only on the Web = packed, from a release or a direct-pack import, never a raw tree. Writable TN = desktop (real files, git2) until there is a reason otherwise. Consolidation upstream (TSV or one file per book) is the content-team ask that would make Web writability cheap; the reader-per-format design makes it one new MIME reader.

## 6. Kinds in hand: facts

**TN** (`type: help`, Markdown chunks). Files are chunks, not verses (`rom/01/28.md` covers 28–29); the last chunk of a chapter needs a verse count, so TN depends on a versification from day one. A note is a `# heading` quoting the ULB plus a body; 57 files repeat a heading and 10 have none, so a heading is not an id. Links: `rc://en/ta/…` (dangling unless tA is registered), relative `../04/09.md`, `[[rc://…]]`, prose citations in intros. Front and back matter is Markdown with no Address at all. Realistic first ask: **keep `en_tn` current**, a fast-forward pull on a root nobody edits locally, with no merge and no diff. The canonical repository is `WycliffeAssociates/en_tn`, not `en_tn_condensed`.

**TQ** (`type: help`). Sparse first-verse files with open ranges (`gen/01/01.md` means "until the next file"; 17 files for Genesis 1's 31 verses), so `places.at(address, ctx)` takes the project TOC and refuses `unresolved` without one. TQ, TN and TW are ULB-numbered; the only TOC Sefer has is the project's, from the engine (tier 3), so tier 2 eventually wants its own versification table.

**TW** (`type: dict`). 1,011 articles in `kt` 210, `names` 347, `other` 454; `bible/config.yaml` already maps each term to its ULB occurrences and `tWs_for_PDFs/*.csv` is the inverse, so `places` needs no scan. 1,008 carry Strong's numbers, the join to Macula. TW is nearly a STET `Term` (`documentation/architecture/stet.md`); TW behind `/terms`'s catalogue port may be the cheapest integration of all, before any pane. The canonical repository is `WycliffeAssociates/en_tw`, about 629 MB with PDFs and an archive; fetch `bible/` only.

**Catalogue gap.** The Language API view behind `app/catalogue.ts` (`vw_consolidated_repos`) has no `en_tn`, `en_tq` or `en_tw` rows. Either an API ask or a second source. Not in any earlier draft.

**Linting material** for non-USFM kinds: dangling `rc://` links, a chunk with no sibling to close its range, drifting TW section headings, duplicate TN headings. All fit the one `Finding` shape. An `rc://` link parser is structured and cheap and may deserve to come beside the prose Citation scanner; TW's own Bible references are `rc://en/tn/help/act/04/33`, addresses routed through TN.

## 7. The fragment: the one generalization with payoff

"Pull TQ in beside the project in a multibuffer" is the excerpt card: a fragment of a document at an Address range shown as a satellite view. Generalising from "a range of a USFM Book" to "a range of anything with `places()`" is one type (a range in, a fragment out), and clip, align and follow all fall out of it. **The carve-out:** the excerpt card obeys "surfaces are judged, not trusted", a tier-3 rule, because it has an engine projection. A TQ or Macula fragment has none, so the generalised fragment needs an explicit "no projection, read-only" case, decided before the first non-USFM satellite.

## 8. Edit, diff, git

- **Git is a container concern.** Clone, pull, versions and sync operate on a root; nothing in them knows USFM. "Keep `en_tn` current" is tier 1 and mostly exists.
- **Diff is dispatched by kind, like rendering.** Diff for USFM is the Onion decision-unit implementation; diff for text is CodeMirror's merge view with pick-left-or-right; Apply writes through Book either way. "Sid-aligned diff only" is a rule about scripture, not about Sefer. Nothing to build until something non-USFM is edited or "show what changed" is wanted on a pull.
- **TN edits the file, not the note.** Duplicate and missing headings argue against notes as editable records. Exact text is the source of truth; parse for display and search; the edit unit is the chunk file, written back per file. `edit?` is typed as "open a Book at an address" and stops; Book brings changes, history, the journal and the explicit save model for free. What a decision unit is for Markdown is per-kind and nobody has asked; left untyped, as a named non-goal.
- **Comments** anchor by checksum and offset, tier 1, and need no scripture. Their hard part is the sharing model: a public repository has many copies, so "whoever has the link" does not transfer. Own plan (`00-ideas/commenting-and-discussion.md`).
- **Remote editing** cannot use the explicit-save model as-is (whose version is recorded, what does Recovery journal). Decide when the first remote editable kind exists.

## 9. Macula: the stress test

Against `@wycliffeassociates/macula` 0.1.0: `openCorpus(src)` fetches one blob into wasm memory and returns a `Corpus` whose every method is synchronous after that; vocabulary `Passage { book, chapter, verseStart, verseEnd }`; self-described `dimensions()` and `facets(q)`; a `Query` is `target`, `preset`, `filters`, one level of `within`, one of `contains`, a `scope`; `run()` hits with highlight spans; `read(book, chapter)`; `word(term)` with parsing and ancestors; `lookup()` by gloss, romanisation or script; `search(needle)` over surface forms. The SPA around it is not adopted; the package is, like Galley: installed from a tag, tested upstream.

**Tiers.** Tier 1: one opaque blob (Greek smaller, Hebrew ~44 MB) stored as one object, identified by checksum; no Book, no git, no edit, no files. Tier 2: everything; `Passage → Address` is the one translation; Hebrew is WLC-numbered, so versification bites here first. Tier 3: nothing. The only tier-3 link is through the project: Addresses resolved by its TOC into excerpts, and later word alignment, which is `\zaln` milestones in a USFM Book, not Macula.

**Bespoke, and it stays bespoke.** URL and checksum are compiled into the adapter; no manifest; `recognize()` never involved. A third `ContainerKind`, `builtin`, whose `root` is the path of the one cached object. `root` stays a string and `library.json` keeps its shape. Generalising `root` into "directory or blob descriptor" waits for a second blob-shaped kind. The point is not that blobs are first-class; it is that a bespoke kind integrates without bending the common path.

**Lifecycle.** The kind table maps `macula-greek | macula-hebrew` to `src/platform/*/macula.ts`. Nothing opens at project open; `shell.resources` opens on first pane mount or first query, with `onProgress` driving the one justified progress bar and `wasmUrl` pointing at the `.wasm` Vite serves; the wasm module initialises once per page. The blob is cached as one object keyed by checksum, which is also `info.identity`; desktop reads a file. Released on project close or when the shell decides memory matters: 44 MB of wasm memory is why the shell owns lifetime, not the pane.

**Typing.** The blob is never typed; it is bytes with a checksum. The package's `JSON.parse as T` casts are inside its `Corpus` class and covered by its selftest. Sefer validates at one point: `info()` at open, through an Effect Schema, so a wrong or corrupt blob fails there with a typed error. After that results are trusted shape and converted to `Address` on the way out of the adapter; nothing downstream holds a `Passage`.

**Slots.** `info`: corpus, `rtl`, books, `versification` set by the adapter. `places.at`: `read()` filtered to the range. `search`: the override; `dimensions()` builds the facet UI (same UI for both corpora, which is why it is a kind's override and not a pane's hard-coding), `facets()` live counts so no dead ends, `passages()` → Addresses for the project's text, `run()` → hits for Macula's own pane, `lookup()` the Latin-keyboard way in. `fragment`: `read()` for the range with hover → `word()`; the "no projection, read-only" case, and why Macula owns its DOM (right-to-left, morphemes, hover). `edit`: absent, correctly; correcting an alignment is a write to the project's USFM.

**Enhanced find and hover.** When a bound handle has `search`, Find gains that kind's panel beside the text find, supplied by the registry like a pane. Every panel returns one shape: Addresses, optionally with the kind's own hit cards; Addresses go to the multibuffer, cards stay in the panel. Find never learns what a facet is. Hover splits in two: inside Macula's pane it is its own DOM and free; hovering a word in the project's text to see its Greek needs an alignment the project must carry first (open question 2). Until then Macula emits only the verse Address.

**The worked query, πίστις Χριστοῦ.** Everywhere the Greek has πίστις with genitive Χριστός in the same noun phrase, how did this project render it, and consistently? (1) `lookup` both lemmas. (2) `run({ target: "constituent", filters: { class: np }, contains: { lemma: pistis } })` → every NP containing πίστις with its `term`. (3) The package allows one `contains`, deliberately, so the adapter applies the second condition: `word(term).ancestors` finds the NP and its words are checked for Χριστός in genitive; synchronous and local, milliseconds. Intersecting two `passages()` at the verse answers "both somewhere in the verse", not the question. (4) Survivors collapse to Addresses. (5) The project resolves each through its TOC into an excerpt and the multibuffer shows every rendering side by side as satellite editor views; the reviser fixes the odd one out in place.

**No Macula-shaped bump.** Facets, presets, the word card, right-to-left reading are Macula-only and live in its pane and panel, not in `ResourceHandle`. A slot enters the shared record when a second kind implements it. That is the difference between "Macula fits" and "the interface was shaped around Macula".

**What it stresses:** platform-only adapter; lazy open with progress; a source of truth that is not text; a kind overriding `search`; answers below the verse; a different versification; its own RTL DOM; read-only with no files at all. Every other kind is a subset of that list. If the handle, the registry, `Held` and the fragment carry Macula without a special case, they carry anything.

### Word-aligned USFM, the same shape one step further

Aligned USFM is ordinary USFM with `\zaln-s … \zaln-e` and `\w`; the editor opens it today. The alignment is the new thing: a word in the project's text (a Location) to a Macula word or a U23003 `MAT 2:1!3`, which is below the Address. `places` answers at the verse as today; aligned-word highlighting needs a finer answer, a Location in the resource's own text beside the Address, which is open question 2. Correcting an alignment is a write to the Book's milestones, judged like any edit.

## 10. What a project is for (`uses`), carried along

Two registries that do not know each other: the project index (`.sefer/projects.json`) has no field for purpose; the Library keeps kind and role apart. Gateway texts arrive through `rememberProject` and become ordinary project rows. Suggestion, undecided: `uses: ("edit" | "read" | …)[]` on a project (index `v: 4`, repaired from `from`), every import gives a purpose, screens filter by it, folders by purpose last. TN needs none of it: the role says what a resource is for in this project, the kind's capabilities say what it can do, and each screen asks for the roles it reads. Whether `uses` is needed at all, or "edit" is just "a USFM kind with no role in another project", is decided alongside this document.

## 11. Named, not solved

1. **Versification.** WLC numbers Psalm titles, Malachi 4, Joel differently from English. A resource declares its scheme (`info.versification`); mapping between schemes is a primitive Location lacks. STEP's TVTMS is the dataset; a kitchen-side idea is in `scripture-kitchen/planning/ideas/candidates/versification.md`. Every TOC-dependent reader (TN last chunk, TQ open ranges, "verse does not exist") waits on this or borrows the project's TOC.
2. **Below the verse.** Word and morpheme places are Locations in a resource's own text, not Addresses. Whether `Places` grows a finer answer is decided by aligned-word highlighting.
3. **Where adapters come from.** Built in, all of them. The interface assumes nothing about it, which is why every call is an Effect.
4. **Remote editing.** When the first remote editable kind exists.
5. **Loading and memory.** Whole or lazy per book is each adapter's call; the Web storage shape is now known (packs).
6. **Edit semantics for TN.** The chunk file as edit unit dissolves most of it except sync; Web writability is the remaining cost.
7. **Identity across versions.** The Fingerprint rule applied to resources; Macula's is the blob checksum.
8. **Licensing and attribution.** `info` may need it.
9. **Helps on the Web.** Not in the catalogue; API ask or second source.
10. **Judged surfaces for non-USFM fragments.** The explicit read-only case (§7).

## 12. Decisions that are Will's

- The `ContainerKind` / `ContentKind` rename, first and alone.
- `place.focus` ShellEvent variant versus a separate `shell.place` signal.
- Which proof first: Macula (the hard case: wasm, platform Layer, facets, builtin container) or TN read-only (the common case: `recognize`, chunk ranges, `Held`, packs, zero new dependencies). The first-pass order was Macula, then TN read-only, then TN editable as the test that Book is about text.
- TW behind `/terms` rather than a pane.
- Whether `uses` rides along.

## 13. Asks that fall out

- **Macula package:** a second `contains` or an `and` of them; a constituent id on `Hit`. Same list as the kitchen asks.
- **Content team:** TSV or one file per book for TN and TQ; a release artefact with per-book packs; `relation` and `versification` filled in manifests.
- **Language API:** rows for the helps, or a stated second source.
- **Galley:** nothing new; the Reading mask stays its lifecycle.
