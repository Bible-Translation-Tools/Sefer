# Gap analysis: scripture-editor-proto-2 → Sefer (2026-09-14)

Read-only sweep of both repos after the Tailwind/screens rounds. Excludes Form mode (deliberately not built) and automated tests (deliberately none yet). "Present/partial/absent" is judged on UI reachability, not on whether a core function exists.

## Ten most significant gaps, ranked

1. **Symmetric compare against arbitrary sources** — proto `domain/project/compare/*` (18 modules; DiffModal chapter/list views, decision map, Apply). Sefer's `core/diff` is Book-vs-one-baseline only. This is the reconciliation story.
2. **Save-time external-change / conflict detection** — `externalChanges`/`resolve` exist in `core/save/saveCoordinator.ts`; nothing calls them. A file edited outside Sefer is overwritten silently.
3. **Cloud reconciliation UX** — sign-in/attach/push/pull exist (`ui/CloudPanel.tsx`); the incoming plan, diverged squash, dual clocks and plain-language sync narrative do not.
4. **Format / prettify** — toolbar "Format book" is disabled; `multibook.runAcrossBooks` has no caller.
5. **STET data layer** — `StetView` exists over a stub; no catalogue, terms, glosses, GL snapshot, locale guides. `app/workflows/stet.ts` dies.
6. **Recovery correctness and surfacing** — no replay freshness check, no reopen-time banners, no forced review of conflicted chapters.
7. **Project lifecycle unreachable** — create (form writes nothing), rename, delete, export exist in `core/admin/projectAdmin.ts` with no UI caller.
8. **Metadata editing + validation issues** — proto had `/metadata` with Burrito/RC editors and an issue panel; Sefer only decodes.
9. **i18n is a seam, not a feature** — `app/i18n.ts` is identity + interpolation; proto shipped Lingui with en/es catalogues. No locale switch, no RTL.
10. **Editor authoring affordances** — marker insertion toolbar, verse-marker suggest, context-menu action palette, USFM-aware copy/paste (`recipes/copy.ts` is a dead export), chapter-label picker, frontmatter form; plus no mobile layout and no View/Plain modes.

## By area

### Projects & import
- Local list/open — present (`landing/YourProjects.tsx`), adds recent projects.
- Import zip/folder — present via OPFS intake + `core/resources/import.ts`; RC `manifest.yaml` classification is textual (no YAML parser).
- Remote import — partial: Gitea clone only; no arbitrary archive URL, no native download path, no WAF header handling.
- Create — partial: form validates, writes nothing (`CreateProject.tsx` TODO; `ProjectAdmin` has no create).
- Rename/delete/export — core only, no UI.
- Metadata editor — absent.
- Project switcher — present (sidebar header + `/projects`).

### Editing & modes
- Regular mode — present. USFM — present. View (read-only) and Plain modes — absent.
- Marker insertion / verse-marker suggest / context action palette — absent (global command palette has no marker verbs).
- USFM-aware copy/paste — partial, dead export.
- Format/prettify with reversible review — absent (disabled button).
- Match formatting from a reference — absent (stub dies).
- Frontmatter form, chapter-label picker — absent.
- Labelled cross-book undo with cursor restore — partial: CodeMirror history per book; `multibook.pendingUndo()` unwired.
- CRLF/EOL preservation — absent by decision (save writes canonical LF).

### Navigation
- Book/chapter sidebar — present. Jump-to-reference box — present in sidebar (`workspace/books.ts` `parseReference`). Mobile layout — absent.

### Reference / resources
- Reference panel — partial: shows bound resources; no catalogue browse/download or binding UI (`library.bind` uncalled).
- Editable reference pane synced by sid — absent.
- Translation Notes typed item — absent; `library.lookup` is a provisional regex scan.

### Findings / lint
- Two-producer findings inline + panel, filters, cursor — present; adds chapter:verse, collapsed duplicates, pattern index.
- Fix from a finding — partial: Onion one-at-a-time; no bulk run.
- Main-thread local lint (numbering monotonicity, `\cl`) — absent.
- Character inventory — present, new-only (`routes/inventory.tsx`); a conviction list until the engine publishes a census.

### Search
- Project-wide find with case/whole-word/regex — present. Replace — absent by decision. Result browser — partial: excerpt multibuffer with outline and expand; no "case mismatches first" sort, no search-the-reference option.

### STET
- Panel/view — present over the excerpt list. Data — absent (see gap 5).

### Save / history / git / cloud
- Save & Review with per-hunk/per-file revert, diff vs last commit — present.
- Symmetric compare of any two sources, decision map, print changes — absent (gap 1).
- Git checkpoints/history list/diff — partial: no "open an older version" navigation; Tauri git layer is a `Refused` stub.
- Autosave to disk — present, new-only.
- Cloud — partial (gap 3). Offline/network status — absent. Commit author — hard-coded `Sefer <sefer@localhost>`.

### Recovery
- Journal + Restore/Discard — partial, inside the Save panel; no reopen banner, no freshness check, no forced review (gap 6). External-change conflict at save — absent (gap 2).

### Settings / i18n / theme
- Settings (theme, font size, zoom, mode default, chapter view, write-to-disk delay, sidebar) — present. "Auto-accept my work on save" — absent. i18n — partial (gap 9). Light/dark — present.

### Platform
- OPFS + isomorphic-git on web — present. Tauri fs/dialogs/updater + update pill — present; Tauri git stub, `chown`/`readLink` unimplemented. Reveal in file explorer / save-dialog export — absent. Off-main-thread analysis — desktop only (native corpus); web runs wasm on the main thread, backups and Onion lint main-thread. System fonts — absent.

### Dev / observability
- Structured logs/traces — present, stronger than proto. Style-guide/playground routes — absent (Sefer has `/dev/fixture` + `verify:launch` instead).

### Prototyped-but-unfinished in proto
- Cloud publishing/sync collaboration design notes; onboarding tour; `/playground` state gallery; `/scaffold` stub; local-lint producer "in flight"; release channels + updater (present in Sefer, flagged as failing on first run in the build-out review).
