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
- Cross-project find stays the `/find` route with the same list.

## Diagnostics popovers

Inline lint tooltips and gutter popovers use tokens (opaque surface, readable text in both themes) and show the fix as a button when the finding carries one.
