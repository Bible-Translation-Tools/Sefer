# Click-through guide: every user flow, old editor vs Sefer (2026-09-14)

For evaluating the new app by hand. One line per thing a person can do. Tags:
**same** — behaves like the old app · **changed** — deliberately different, how is noted · **new** — not in the old app · **partial** — exists, missing a piece · **stubbed** — visible, refuses with a reason · **deferred** — Will said later · **undecided** — Will has not ruled.

## Getting a project

- **See my projects** — same. Table with name, language, books, last opened. _changed:_ backed by a JSON index with cheap repair, not Dexie; recents also drive the sidebar.
- **Open a project** — same. _changed:_ books are analyzed once on open and every book is registered with the corpus, so Findings covers the whole project without opening files.
- **Import a zip** — same on Web (unzipped into app storage, classified, committed). Tauri: native folder picker only, zip via same intake if a file picker is wired — check.
- **Open a folder** — same on Tauri (real path). _changed:_ on Web the folder is copied into app storage instead of read in place (the browser gives handles, not paths).
- **Clone from cloud** — partial. Gitea sign-in + repo list + clone exist; needs `VITE_SEFER_GITEA_WEB_HOST`.
- **Find a project in the catalogue and download it** — partial. The Find Project screen renders with filters, sort, search; rows are sample data unless `VITE_SEFER_LANGUAGE_API_URL` is set; Region and Date columns show a dash (not in the API).
- **Create a new project** — stubbed. Form validasrito metadata; the Create button is disabled "not available yet" (no `ProjectAdmin.create`). Old app had no create flow either.
- **Rename** — new (old had it in specs). Kebab on the row → dialog → metadata name + index update; folder does not move.
- **Delete** — partial. Core exists; check whether the row offers it.
- **Export as zip** — new on Web (download). Tauri save dialog in progress.
- **Edit project metadata (Burrito / RC forms, issue panel)** — deferred. Will wants to rework; only the md5 checksum refresh on save is built.
- **Attach a shared project / publish** — same, on the project page's Cloud card.

## The workspace

- **Sidebar with books and chapters** — changed. Old: book/chapter picker sidebar. New: resizable sidebar, testament sections, "Review" pill per book with findings, 4-column chapter grid under the open book, collapses to an icon rail. Width persists.
- **Jump box "Luke 1"** — new. Parses book name/code + chapter.
- **Switch project from the sidebar header** — same.
- **Icon rail** — new. Refine / Key terms / USFM modes; Projects, Inventory, Compare, Cloud, Findings (badge), History, Settings.
- **Reference texts beside the editor** — partial. Column exists; shows bound resources' passage; no in-app catalogue browse/download/bind yet (empty state points to Projects). Old had an editable reference pane synced by verse — not built.
- **Translation Notes pane** — deferred/absent.
- **Phone layout** — deferred.
- **Update available** — same. Pill in the sidebar footer, update section in Settings.

## Editing

- **Regular (reading) mode** — changed in mechanism, same in feel: CodeMirror over the exact USFM with markup painted hidden; every keystroke goes through the kernel's rules (no typing inside hidden markup, markers deleted whole, caret settles on legal positions). Old was Lexical nodes.
- **USFM mode** — same (raw text, terminal palette, lint marks).
- **View (read-only) mode** — absent. Old had it. _undecided._
- **Plain mode** — absent. _undecided._
- **Form / blocks mode** — deliberately not built.
- **Chapter view** — same (open a chapter clipped, setting to prefer it).
- **Verse numbers** — changed: superscript in brand blue (mockup), old was inline.
- **Footnotes** — changed. Old: nested editors inline. New: the note body is hidden in the flow and listed after a rule at the bottom of the book (mockup); Insert footnote (Mod-Shift-F) wraps the selection in `\f + \ft …\f*` and puts the caret in the note; a selection crossing markup gets an empty note instead. Evaluate whether editing the note at the bottom feels right.
- **Insert verse / paragraph / poetry line** — new as structured actions (Mod-Shift-V / P / L, palette). Verse number is selected after insert so typing overrides it. Old had a marker toolbar with more markers; the rest is meant to be typed and linted.
- **Verse-marker suggestions while typing** — absent. _undecided_ (Will: "lint and regular typing to enforce").
- **Right-click action palette** — absent. Command palette (Mod-K) instead.
- **USFM-aware copy/paste** — partial: recipe exists but not installed. Paste rules refuse markup inside a word and pastes that add a chapter.
- **Front matter (\id, \h, \toc, \mt)** — changed. Old: a form. New: a card of labelled fields at the top of the book in regular mode; each edit writes that one line. Marker names locked; rename in USFM mode.
- **Chapter labels** — deferred to Onion.
- **Word attributes (\w … |lemma=…)** — new (from the spike): hover tooltip with editable attributes.
- **Undo / redo** — changed. Per-book CodeMirror history, one step per structured action or fix. Old had a labelled cross-book stack with cursor restore. _undecided_ whether the labelled stack matters.
- **Format / prettify** — stubbed. Format book / Format project refuse until galley re-exports Onion's format door (planning/01-discussing/engine-asks-2026-09-14.md).
- **Match formatting from source** — stubbed, needs an Onion overlay.
- **Text size / zoom** — same (Settings: interface size, scripture size, zoom).
- **CRLF preserved** — same. A file is written back in the dominant line ending and byte order mark it was read with, so a CRLF project stays CRLF and a marked file keeps its mark. Canonical LF is INTERNAL only: it is what the text is in memory, which is what makes a UTF-16 offset mean the same thing to CodeMirror, to the engine and to a stamp. See [Save](../../documentation/architecture/save.md) and the "Line endings" line below.

## Findings and lint

- **Inline underlines + gutter markers** — same. _changed:_ two producers inline now — Onion per keystroke, Sous corpus findings pushed after each publish.
- **Hover popover with a Fix button** — same idea, restyled; Fix applies through the Book (undoable) and refuses if the text moved.
- **Findings page** — same idea. Filters (severity, producer persisted; books, codes, text per session), views by book/code/severity/flat, j/k cursor, Enter opens, "N of TOTAL shown". _changed:_ rows show chapter:verse; identical consecutive rows fold with a count; group headers name books.
- **Fix from the panel** — same, one at a time. No bulk fix run.
- **Local lint (verse/chapter numbering monotonicity, \cl)** — absent; Onion reports numbering-mix etc. Check whether anything is missed.
- **Character inventory** — new. Per-glyph stats from Sous + flagged sites with Go. Only convicted glyphs until the engine publishes a census.

## Search

- **Find in book / project** — changed. Old: result browser rows + editor highlight. New: a Zed-style multibuffer: sticky book headers, one excerpt per verse (± one verse, expandable up/down), hits highlighted, outline with counts, prev/next. Case / whole word / regex toggles.
- **Edit from a result** — changed: excerpts are read-only until Edit, which swaps in a satellite editor over the canonical book; Done collapses it.
- **Open in editor** — same (aims and scrolls the main editor).
- **Replace / Replace all** — removed on purpose (scripture too fragile). Core functions kept.
- **Search the reference project** — absent; engine ask (references are registered as verse lengths only). See engine-asks 3b.
- **Sort "case mismatches first"** — absent.

## Key terms (STET)

- **Term list with glosses, counts, references** — same data (old catalogue, en / es-419 / pt-br guides).
- **Source verse with the term highlighted beside the target verse** — same idea; _changed:_ pairs render in the excerpt list; target edits via Edit → satellite. Own route `/terms`, not a Find toggle.
- **Done / approved state per occurrence** — absent (counts read 0/N). Ignore per Will.
- **Show all references switch** — same.

## Saving, versions, cloud

- **Automatic write to disk** — removed (Will, 2026-09-14: "I'd rather old model"). Nothing writes the project file on a timer. The old model is back and it is now the only model: the file is written when a version is recorded, and at no other time.
- **Working-state backup (crash journal)** — same purpose, and now the ONLY automatic write. Debounced journal, never per keystroke; the idle bound is a visible preference ("Back up work after", default 500 ms). It is not the file and it is not a version.
- **Save & Review** — changed. Old: save + diff modal. New: "Record a version": book list with counts, unified diff against the last recorded version, per-hunk and per-file Revert (confirm dialog), commit message. Mod-S opens this screen with the message field focused and Enter records. The primary writes the files and commits them as ONE action — a failed write records nothing; a failed commit says the files are on disk with no version behind them. Diff is against the last commit.
- **Line endings** — new. A file's dominant line ending (and a UTF-8 byte order mark) is remembered at read and re-applied at write, so a CRLF project stays CRLF. In memory everything is canonical LF. A file that mixed styles becomes uniform in its majority form the first time it is recorded.
- **History** — same idea: commit list with books changed, diff of a commit against the working text, Revert from a commit's diff. _partial:_ no "open an older version" browsing mode; no diff between two arbitrary commits.
- **Compare two copies** — new (old had a bigger 18-module version). This project vs a zip or folder; per hunk Keep left / Take right; Apply writes the chosen text (undoable); whole-book add/remove refused for now. Git checkpoint, another project, remote sources are the next files to add.
- **Print changes** — absent. _undecided._
- **Cloud: sign in, attach, publish** — same.
- **Cloud: pull / push with a plan** — changed/partial. New Sync screen: state (detached … diverged … offline), two clocks, incoming plan in sentences, one primary action. Combine (squash mine onto theirs) and Resolve refuse until the branch-move verb lands (in progress).
- **Conflicts** — changed: books changed on both sides route to Compare; text is never auto-merged.
- **Offline indicator** — new-ish: sync state shows offline.
- **Someone else changed the file on disk since I opened it** — deferred (hooks exist, not surfaced). With no auto write there is no longer a timer racing the other editor; recording still overwrites without asking.

## Recovery

- **Banner on reopen after a crash: Keep / Discard** — same idea. _changed:_ checked once on project open; a backup whose text already reached disk is deleted silently; Keep restores through the Book (undoable) and leaves the book **unsaved** until somebody records a version — nothing writes it later on its own. With explicit-only saving the banner is now the ordinary outcome of an interrupted session rather than a rarity.
- **Forced review of conflicted chapters** — absent. _undecided._
- **"Auto-accept my work on save" setting** — absent.

## Settings, theme, language

- **Theme light/dark/system** — same. Token swap, both themes on every screen.
- **Interface text size, scripture text size, zoom** — same.
- **Editor mode default, chapter view default** — same.
- **Findings filter persistence** — same.
- **App language (Lingui en/es)** — deferred. Every string passes through `t()`; no catalogues. Library choice open (Paraglide vs Lingui core).

## Platform

- **Web (OPFS + isomorphic-git)** — same.
- **Desktop (Tauri)** — same for files, dialogs, updater; git port being completed now; native save dialog for export in progress.
- **Off-main-thread analysis** — changed, and narrower than it sounds. The HOT path — per-book `analyze` on the keystroke — is synchronous wasm in the webview on BOTH hosts, and always will be: a fiber per keystroke is a budget Sefer does not have. What moves off the main thread on desktop is the debounced whole-corpus Sous publish, which runs in the native process (rayon, `src-tauri/src/corpus.rs`); on Web that publish is still main-thread and a Worker is the next step. The old app mirrored the whole workspace into a worker.
- **Reveal in file explorer** — absent.
- **System fonts** — absent.

## Dev

- **Fixture project + launch helper + observability ring** — new and stronger than the old traces.
- **Playground / scaffold routes** — absent (not needed).
