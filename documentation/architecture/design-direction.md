# UI direction (Sept 2026)

Working notes for the Tailwind rebuild. Source of truth for look is the designer's Figma; these are the mockups in words, so an agent without the images can build to them. Reference implementation for flows: `../scripture-editor-proto-2` (React, vanilla-extract, base-ui, lucide-react). We port flows and layout, not code.

## Stack decisions

- Tailwind v4 via `@tailwindcss/vite`. The semantic tokens in `src/app/ui/tokens.css` become the `@theme` source (`--color-surface-primary` → `bg-surface-primary`). Components use semantic utilities only, never ramps. Dark stays a token swap under `[data-theme="dark"]` and `prefers-color-scheme`.
- Solid 2 RC. Component library: **corvu-next** (`@corvu-next/resizable`, `@corvu-next/dialog`, `@corvu-next/popover`, `@corvu-next/tooltip`) but ONLY behind our own wrappers in `src/app/ui/primitives/`. Nothing outside `primitives/` imports corvu. The library is thin and will likely be swapped; the wrappers are the seam.
- Icons: `lucide-solid`.
- Reusable primitives, co-located utility classes, a tiny variant helper (`cx`/`variants` in `primitives/cx.ts`). No CSS-in-JS. `src/editor/editor.css` stays a hand-written CodeMirror theme but consumes the same tokens.
- Light-first. Both themes must read.
- No tests for UI yet (behaviour not locked). Commit per module to `master`.

## Overall layout (editor workspace, "Sefer-21 / Collapsed" mockup)

Page ground is a cool light gray (`surface-secondary`). Content sits in white cards with 12–16px radii and a very soft shadow.

Left: a **project sidebar**, white, resizable (corvu Resizable), collapsible to an **icon rail**.
- Header card: project name in bold ("Shila"), language id beneath in muted ("bem-x-shila"), chevron → opens the project switcher / Find Project.
- Search field "Search 'Luke 1'…" (navigation dropdown mockup) that jumps to a book/chapter.
- Book list: rows with a book icon, the name, a chevron. Section labels ("Old Testament", "New Testament") between groups. The open book is brand-blue with a filled icon and expands a **chapter grid** of 4 columns of rounded tiles; the current chapter tinted `brand-95`/`brand-40` text. A book with findings shows a small pill on the right ("⚠ Review" in warning tint).
- Footer: "Settings" with gear; an "Update available" pill when the updater says so.

Collapsed to a rail (STET mockup): 48px wide column with icon buttons — panel toggle at top; the mode icons (Form=table, Refine=book, Key terms=list-check, USFM=code); at the bottom the gear and an avatar/initials. Active icon has a `brand-95` tile behind it. **Form is not built**: omit the Form icon entirely for now.

Top toolbar of the workspace: left title "Mark 5 (Shila)" (book name, chapter, project); centre a **segmented control** for mode (Regular Mode with book icon labelled when active; Key terms; USFM — no Form); right a card with: search input, undo, redo, findings bell with red numeric badge, kebab menu.

Centre: a **reference column** (resizable pane) of cards, each a small serif excerpt (muted, 3–4 lines, clipped) above a divider, then resource title bold ("English") and edition muted ("Unlocked Literal Bible"). Clicking a card expands it.

Right: the **editor card**, white, generous padding, scripture in a serif (Charis SIL → Iowan Old Style → Georgia), headings bold, verse numbers superscript in red/brand, poetry indented, footnotes listed at the bottom after a rule as "a. Matthew 9:1 …".

## Find Project ("Sefer / Find Project / Start" mockup)

Breadcrumb top-left "Sefer / Find Project / Start" in muted text. Left filter card "Find Project" with a "← Go back" link; segmented toggles: Language name (Natural | Anglicized) with a small explainer line; Project type (Translation | Gateway) with explainer; Region select "🌐 All regions  654 ▾"; outlined full-width "+ Create new project" button. Right: a large rounded search field "Search 'english' or 'axd'…"; a table with sortable headers Code | Language | Region | Date and a "⬇ Download" link per row. Rows: code muted mono-ish, language bold.

This is the remote catalogue browser. Local projects list (proto's IndexRoute/ProjectList) and the import hub (zip / folder / cloud) sit on the same landing screen as tabs or sections: "Your projects" first, "Find project" second.

## Key terms / STET ("STET / Ideal" mockup)

Heading "Spiritual Terms"; search field; toolbar (undo, redo, findings badge, Save, kebab). Left: list of term cards; each shows the term bold and a "done/total" count (green check when complete). The expanded term card shows the gloss ("This word can mean:" bullets), a "Hide verse references ^" disclosure, a list of references with per-row state icons, and a "Show all references (43)" switch. Right: per-verse rows, each a pair of cards: source (bookmark icon, "Matthew 8:13 –" bold, text with the term highlighted yellow) and target ("Mateusz 8:13 –", target text). The focused row is elevated with a larger card. Ignore approve/state affordances.

## Key terms (STET) reuses the Find excerpt pattern

STET is the same multibuffer: the list of excerpts is **prebaked on the source side** — for a term, the source occurrences (source book, verse sid, highlighted span) are the "hits", and each excerpt shows the target verse for that sid beside the source verse (the pair of cards in the mockup). Same per-sid header, same read-only default, same Edit → satellite on the target text, same Open in editor. Build one excerpt-list component and feed it from two producers (search hits, term occurrences).

## Find (multibuffer, read-only until asked)

Not a modal over the text. A pane beside the text. Results are a virtualized list grouped under a **sticky header per book** (the project/book is our "file"): "PHM · Philemon  ·  3 hits".

Differs from Zed's multibuffer deliberately:

- Hits are grouped by the **verse sid from Onion's table of contents**; one excerpt per unique sid, however many hits fall inside it. Each excerpt has its own small header: the reference ("Philemon 1:4"), an **Edit** button, and an **Open in editor** action (aims the main editor at the hit).
- Excerpts are **read-only by default**: plain projected text of the hit's verse plus one verse either side, hits highlighted. Cheap to virtualize, no accidental edits from a results list.
- **Edit is a click.** Edit swaps that one excerpt for a satellite editor (`src/editor/recipes/satellite.ts`) clipped to the same span, writing through the funnel to the canonical Book. Done (or leaving the excerpt) collapses it back to read-only text re-read from the Book. Only one or a few satellites are live at a time.
- An **outline** beside the list: one row per book with its hit count ("PHM 3", "JUD 12"), in canonical order. Clicking a row scrolls the virtualized list to that book's sticky header; the row for the book currently in view is highlighted as the list scrolls. STET gets the same outline (per term, and per book inside a term).
- Cross-project find stays the `/find` route with the same list.

## No Replace in Find; Revert stays in Review

Scripture is too valuable and fragile for a blind Replace / Replace all, so Find has neither; edits happen in an editor surface (main editor or an excerpt's Edit). Review and History DO keep per-hunk and per-file Revert — a reviewer looking at a diff and choosing to undo one hunk is a deliberate, visible act, "nicer but similar to old editors" (proto's DiffModal). ~~Review diffs against the last recorded version (the commit), never against the auto-written save baseline, or a dirty session reads as clean.~~ **Superseded by decision 6 (2026-09-15).** That rule was written while the file was still auto-written, which is what made the save baseline useless as a review baseline. Under explicit-only saving the baseline IS the file, the file is exactly what nobody has agreed to change, and diffing against it is the only way an untouched project reads as untouched — diffing against the commit made a 66-book project with no repository offer to record all 66. Review diffs against `SaveCoordinator.baseline`; History keeps the commit diffs.

## Editor palette

The regular-mode editor is the prototype's look on our tokens — white card, on-surface ink, brand-primary verse and chapter numbers — not the sepia paper and warm ink inherited from the editor spike. USFM mode keeps a terminal palette.

## Diagnostics popovers

Inline lint tooltips and gutter popovers use tokens (opaque surface, readable text in both themes) and show the fix as a button when the finding carries one.

## Decisions on the gap list (Will, 2026-09-14 evening)

1. **Compare / Review are one screen.** Both sides are pickers over the same `CompareSource` list (in the editor · on disk · last recorded · a zip · a folder; later git checkpoint, other project, remote). Left defaults to the editor, right to on disk; neither side is hard-coded, so zip vs zip is allowed. Apply / Record / Revert are offered only when one side is this project's working text (that side is the target); when neither can apply the screen is read-only and says so. Same source on both sides is disallowed. Units come from Onion's diff skeleton once galley re-exports it (engine-asks 1b); until then a TS diff feeds the same shapes, labelled interim.
2. **External-change detection at save.** Deferred. Keep the coordinator hooks; too speculative to surface now.
3. **Cloud sync narrative.** Wanted. The old state machine (incoming plan, diverged squash, dual clocks, plain-language plan) was about right; port its shape.
4. **Format.** Wanted, for a book or the project, from the kebab and the command palette; call it "Format". Match-formatting is NOT this — it needs an Onion overlay of two texts first (engine work), then show source text with the equivalent block highlighted.
5. **Key terms.** Same data the old app used is fine for now. Find and Key terms are SEPARATE panes/routes with similar UI, not a mode toggle on one page.
6. **Save model: explicit only.** The real file is written only by Save & Review, which writes and commits as one action ("Record a version"). The automatic debounced write is the working-state BACKUP, never the file — Will: *"Write to disk is work in progress backups (and memory of course) but actual file is only written with a commit."* The setting is "Back up work after"; Mod-S opens Save & Review with the message focused; the book status line says unsaved / recorded / on disk, not recorded. Files are written back in whatever line-ending form they arrived in — Will: *"Files might should theoretically write whatever the dominant form is on way back to actual disk."*
7. **Recovery.** Wanted: on project open, one IO check for backups; clear a backup when the disk file (normalized LF) matches it; otherwise Keep/Discard banner. Debounced journal, never per-keystroke writes, resilient.
8. **Project index.** No Dexie. Don't rescan every project on open. A small JSON index updated on import/create/rename/delete/open, assumed correct, with cheap repair (names-only listing). Export as zip (fflate is now a dependency) and rename: yes.
9. **Metadata page.** Deferred; to be reworked. Needed regardless: a pipeline hook that refreshes the burrito's md5 checksums on write (web needs a JS md5 — no SubtleCrypto md5).
10. **i18n.** Evaluate Paraglide (see notes in the session).
11. **Authoring.** Structured actions for `\v`, `\q`, `\p` and footnote insertion only; everything else is enforced by lint + typing rules. Front-matter as structured data entry like the spike's attribute editing. Chapter labels: Onion's job, later. Phone layout: later.

## Diff is sid-aligned, never line-based (todo, no action yet)

Will, 2026-09-15: no line diff anywhere, and nothing native to CodeMirror's merge/diff. Every comparison in Sefer aligns by verse sid through Onion's decision units — that alignment is scripture's advantage and the whole point. Remaining line-diff users to move onto the engine skeleton when the docket allows: History's commit-vs-working view (`panels/DiffView`, `changes.ts`), `core/compare/compare.ts`'s hunk model and `projectSource`, and `core/diff/diff.ts` itself once nothing reads it. (The word LCS in `core/diff/inline.ts` is already gone: both review views mark from the engine's runs.)
