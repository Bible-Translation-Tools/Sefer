# The UI layer

How a screen in Sefer gets its look: Tailwind v4 compiled from the semantic
tokens, one reusable primitive layer, and almost no hand-written CSS.

Read this before adding a screen, a component, or a colour. The design target
is `planning/03-ui/design-direction.md` (the designer's mockups in words); this
document is the mechanism.

## Tokens are the theme

`src/app/ui/tokens.css` is the whole design system and the whole Tailwind
configuration. There is no `tailwind.config.*`: v4 compiles from the CSS.

The file has four parts, in order:

1. `@import "tailwindcss" source(none)` plus one explicit `@source` glob over
   `src/`. Automatic source detection roots at the CSS file's own directory,
   which is three levels below the components that use utilities, so the glob
   is both wider and easier to audit.
2. The **ramps** (`--brand-40`, `--neutral-95`, …) and the **semantic contract**
   built from them (`--surface-primary`, `--on-surface-tertiary`,
   `--button-primary-surface`, `--sidebar-surface`, …), then the dark blocks
   that redefine only the semantic names.
3. `@theme inline` for colours and `@theme` for families, the type scale and
   the radii — the bridge that mints a utility from each name.
4. `@layer base`, the reset.

### The rules

- **Semantic names only.** A component says `bg-surface-primary`, never
  `bg-brand-40` and never `bg-slate-50`. Tailwind's own palette is switched off
  (`--color-*: initial`), so a framework colour is a build error rather than a
  colour that ignores the theme. `white`, `black`, `transparent`, `current` and
  `inherit` survive, because a scrim is composed, not themed.
- **Dark is the token swap, not `dark:`.** `:root[data-theme="dark"]` and
  `prefers-color-scheme: dark` under `:not([data-theme="light"])` redefine the
  semantic names; every utility resolves through them and needs no variant. The
  `dark` variant IS redefined in `tokens.css` to match those two selectors, but
  only so that a stray `dark:` cannot disagree with the swap. Do not reach for
  it: if a value differs between themes, it wants a token.
- **Colours go through `@theme inline`**, so `bg-surface-primary` compiles to
  `background-color: var(--surface-primary)` — one hop, and the swap is the
  only indirection.
- **Our radii replace Tailwind's**, so `rounded-lg` is the product's 12px, not
  the framework's 8px. Cards are `rounded-lg`, dialogs `rounded-xl`.
- **The shadows are `@utility` rules**, not `@theme` entries. Tailwind parses a
  themed shadow so it can offer `shadow-<color>`, which bakes the light colour
  into the class and leaves the dark override unread. `shadow-small`,
  `shadow-medium` and `shadow-large` are hand-written one-liners instead.
- **Class strings must be literal.** Tailwind scans source text; a name built by
  concatenation (`` `bg-${tone}-500` ``) compiles to nothing. That is why the
  primitives keep their variant tables as literal strings at module scope.

`src/app/ui/app.css` is the only global stylesheet, imported once from
`src/App.tsx`. It holds what could not have carried a class: the `<body>`
ground, and `.editor-host` — the CodeMirror frame, whose class
`src/app/ui/BookEditor.tsx` writes itself. Before adding a rule there, answer
which element could not have carried the class instead.

### The highlight pair

`--surface-highlight` / `--on-surface-highlight` is where a FOUND MATCH is
painted: a soft yellow in light, a muted amber in dark. It is not
`--surface-warning`, which the excerpt cards used to borrow — a warning is a
judgement about the text and a highlight is a place in it, and one token
serving both meant restyling a finding would have restyled every search hit.
Everything that shows a match uses the pair: `bg-surface-highlight` on the
read-only excerpt marks, `.cm-excerpt-hit` inside an excerpt's satellite, and
`.cm-mode-regular .usfm-hit` in the page itself.

`--editor-font-size` is the other value written onto `<html>` from outside a
component: the scripture column's own size, applied by `src/app/ui/theme.ts`
from the `editor.fontSize` preference, read by `.cm-mode-regular .cm-content`.

`src/editor/editor.css` is a separate, hand-written CodeMirror theme owned by
the editor module. It is not part of this layer, but it is the same palette:
the REGULAR projection derives every colour from the semantic tokens — paper
is `--surface-primary`, ink `--on-surface-primary`, verse and chapter numbers
`--brand-base`, selection a brand tint — so the page the reader edits is a
white card among white cards and follows the theme without a second dark
block. Four apparatus hues (footnote, cross-reference, nested editor) keep
literal values, because the token set has no name for that distinction, and
they are the ONLY literals left in the regular projection — a fifth, the amber
ring on the note being edited, stayed light-mode amber on a dark card and is
now the warning line at half strength. USFM mode keeps its own terminal
palette on purpose: a terminal is a terminal in both schemes.

Checked against the prototype role by role
(`../scripture-editor-proto-2/src/app/ui/styles/modules/usfm.css.ts` and
`designSystem.css.ts`), the projection matches on every value the two share:
paper `surface-primary` (neutral-100 / neutral-20), ink `on-surface-primary`
(neutral-5 / neutral-90), verse and chapter numbers `brand-base` (brand-40 /
brand-70) and bold, chapter in the serif, poetry on the 16/32/64/96px ladder.
Three roles differ on purpose. Our verse number is SUPERSCRIPT, which is what
the designer's mockup asks for, and a superscript at 0.66em carries the same
weight on the page as the prototype's 0.85em inline number. Poetry is not
italicised, because the mockup asks only that it be indented. The footnote
BLOCK — a rule and then "a. Philemon 1:4 …" at the foot — has no prototype
counterpart at all: the prototype keeps notes inline in nested editors, and
the block is the mockup's.

## The primitives

`src/app/ui/primitives/` is the reusable layer, behind one `index.ts`. Screens
import from the directory, never from a file inside it.

| Export | Shape |
| --- | --- |
| `cx(...parts)` | Flattens Solid's own `JSX.ClassValue` into one string. |
| `variants({ base, variants, defaults })` | Lookup table → class function; `(choices, extra)`. |
| `Button` | `variant` primary/secondary/tertiary/danger, `size` sm/md, `icon`, `loading`, plus every `<button>` prop. `aria-pressed` styles itself. |
| `IconButton` | `label` (REQUIRED — the `aria-label` and the tooltip), `icon`, `variant` subtle/filled/outlined, `size`. |
| `Input` | Every `<input>` prop except `size`; `size` sm/md, `icon` (leading slot), `wrapperClass`. |
| `Select` | Native `<select>`, styled, with a drawn chevron; `size`, `wrapperClass`. |
| `SegmentedControl` | `items` (`{ value, label, icon?, disabled? }`), `value`, `onChange`, `label`, `size`. A radio group; arrows move. |
| `Switch` | `checked`, `onChange`, `label` or `aria-label`, `id`, `disabled`. |
| `Badge` | `tone` neutral/brand/warning/error/success/muted, `size`. `severityTone(severity)` maps a finding's severity to one. |
| `Card` | Every `<section>` prop, plus `padded` (off for full-bleed bodies). |
| `PanelHeader` | `title`, `subtitle`, `actions`, `level` 2/3. |
| `Table*` | `Table`, `TableHead`, `TableBody`, `TableRow`, `TableHeader` (`sort` asc/desc/none + `onSort` makes it a sort control and sets `aria-sort`), `TableCell`. |
| `Tooltip` | `label`, `side`, `children` (the element it wraps). |
| `Popover` | `trigger`, `children`, `label`, `side`, `align`, optional `open`/`onOpenChange`. |
| `Dialog` | `open`, `onOpenChange`, `title` (required), `description`, `footer`. |
| `Resizable` | `.Root` (`orientation`, `onSizesChange`), `.Panel` (`initialSize`, `minSize`, `maxSize`), `.Handle` (`label`). |
| `Kbd` | A keycap. Show the chord exactly as `src/app/commands.ts` spells it. |
| `EmptyState` | `icon`, `title`, `description`, one `action`. |
| `VirtualList` | `sections` (each a key plus keyed rows with a height estimate), `header(section, ref)`, `row(item, key)`, `pinned`, `focus`, `onActive`, `empty`, `ref(goTo)`. Sticky section headers over a windowed list. |
| `toasts` + `Toaster` | `show`/`info`/`success`/`error`/`progress`/`update`/`dismiss`/`dismissAll` over a module-level list; `<Toaster />` is the viewport, mounted once in `src/routes/__root.tsx`. |

Icons are `lucide-solid`, imported one at a time
(`import Search from "lucide-solid/icons/search"`), never from the barrel.

### corvu lives only inside `primitives/`

`Tooltip.tsx`, `Popover.tsx` and `Dialog.tsx` are the only files in the
repository that may import `@corvu-next/*`. The library is thin and will
probably be swapped; these three wrappers are the seam, so a swap is three
files rather than every toolbar in the product. Nothing outside the directory
imports corvu, and nothing outside it should.

`Resizable` is the exception in the other direction: it is ours.
`@corvu-next/resizable` does not survive Solid 2 RC — it fills its panel index
inside a signal updater, Solid 2 runs that updater lazily, and the handle then
asks for a size at index `-1` and dies. The package is not installed; the file
keeps corvu's `Root`/`Panel`/`Handle` shape so that swapping back later is one
import. Collapsing is deliberately not implemented: a collapsed sidebar is a
different tree (an icon rail), not a zero-width panel.

### The multibuffer: `virtual-core`, and why not `solid-virtual`

`VirtualList` is the one windowed list in the product. Find, Key terms
(`ExcerptList`) and `/findings` all render through it, which is what keeps two
long lists in the same project from scrolling differently.

**The geometry is TanStack's; the forty lines of Solid binding are ours.** Will
asked for `@tanstack/solid-virtual` (2026-09-15) rather than the hand-rolled
windowing that was inside `ExcerptList`, and the engine underneath it is what
we took — but the published Solid binding does not run on Solid 2 and cannot be
shimmed into running. The blocker is worth recording, because "it is a Solid 1
package" is not the whole of it:

`@tanstack/solid-virtual@3.13.40` declares `solid-js ^1.3.0`. Three of its
imports are gone in Solid 2 — `mergeProps` (now `merge`), `onMount` and
`createComputed` — and `solid-js/store` moved onto `solid-js`. All four are
shimmable, exactly the way `lucide-solid` is (`tools/vite/lucideSolid.ts`), and
a working shim was written. The one thing that is not shimmable is the SHAPE of
its single `createComputed`: it reads its options and WRITES its item store in
the same function, which is precisely what Solid 2 forbids
(`REACTIVE_WRITE_IN_OWNED_SCOPE`) — and it is not a diagnostic to wave through,
because Solid 2 split tracking from effects on purpose. The `ownedWrite` escape
hatch the diagnostic names is a per-SIGNAL option, and the store being written
is created inside the package. Splitting the function is not available from
outside it either: only the package knows which of its reads are dependencies.
The failure is loud and total — the write throws, TanStack Router reports an
uncaught route error, and the whole shell tears down.

So `VirtualList` depends on **`@tanstack/virtual-core`**, the framework-agnostic
engine both wrappers sit on, which has no framework imports of its own. It is
bound the way the Solid 1 wrapper binds it, with the writes in an effect's
EFFECT phase where Solid 2 allows them. Measurement, the range, the scroll and
resize observers and `scrollToIndex` are all the library's; nothing is
reimplemented. Two Solid 2 details the binding had to get right, both of which
the diagnostics caught:

- **An effect's effect-phase is not a reactive owner.** An `onCleanup`
  registered there never runs (`NO_OWNER_CLEANUP`), so the library's
  `_didMount()` disposer is held at component scope and released by one
  `onCleanup` in the body.
- **A `ref` callback is not a tracking scope.** Reading a virtual item's index
  inside one is `STRICT_READ_UNTRACKED`; the index at mount is the right one,
  and the library re-measures on its own afterwards.

`@tanstack/virtual-core` is in `optimizeDeps.include`. Discovering it when the
first multibuffer route loads triggers a mid-session re-optimization, and a
re-optimization reloads the page — which drops the open project.

### Two Solid 2 facts these wrappers had to learn

- **A JSX expression is a lazy memo.** `a ?? b`, a spread or a call in a prop
  compiles to a getter that creates a memo on first READ. If the library reads
  that prop from inside an effect or an `onSettled`, the memo is created in a
  scope Solid 2 refuses (`PRIMITIVE_IN_FORBIDDEN_SCOPE`) and the page dies. Pass
  a plain variable for anything a library reads late — see `staticOrientation`
  in `Resizable.tsx`.
- **`display: contents` has no box.** corvu's tooltip measures the trigger's
  rect to build the pointer's safe area, so a contents-display wrapper measures
  zero and the tooltip never opens. `Tooltip` wraps in `inline-flex` instead.

## `data-testid`: how a driver finds a control

A screen is driven by an agent or a Playwright script long before it is driven
by a test suite, and both need a handle that survives a reworded label and a
retranslated one. `data-testid` is that handle.

**The rule.** Kebab-case, `<area>-<thing>`, and the area is the piece of chrome
a reader would name: `rail-findings`, `sidebar-book-PHM`, `toolbar-undo`,
`kebab-export-zip`, `chapter-tile-3`, `location-next`, `palette-input`,
`status-commands`, `editor-host`. A book id or a chapter label keeps its own
spelling (`sidebar-book-3JN`, `chapter-tile-intro`) — it is an identifier, not
prose, and lower-casing it would make the selector disagree with the URL.

**Every primitive already forwards it.** `Button`, `IconButton`, `Input`,
`Select` and `Switch` spread the props they do not consume onto the element
they render, so `data-testid` is an ordinary prop with no support needed from
the primitive. Nothing generates one: a control gets an id when something
drives it, and an id nothing uses is a name to keep in step for no reader.

**What has one today**: the rail and each of its tiles, the sidebar with its
project button, its Go-to box, each book row and each chapter tile; the
toolbar, its search box, Undo, Redo, Findings, the kebab and each of the
kebab's items; the location bar with its two crumbs and its two arrows; the
command palette and its input; the status line and its Commands button; and
the editor card and the CodeMirror host inside it.

There are still no UI tests (see below). These ids exist so that a verification
run can be written the same way twice.

## Building a screen

Compose primitives and utilities; do not add a stylesheet. The page shape the
migrated routes use:

```tsx
<main class="min-w-0 space-y-4 p-6">
  <PanelHeader title={t("Findings")} subtitle={…} actions={…} />
  <Card>…</Card>
</main>
```

The ground is `surface-secondary`, cards are `surface-primary` with
`rounded-lg`, `border-surface-border` and `shadow-small`. Every user-visible
string still goes through `t()` (`src/app/i18n.ts`).

There are no UI tests yet — behaviour is not locked. Verify a screen by running
it: `pnpm verify:launch`, then drive `<url>/projects?fixture=1` with Playwright
and look at the screenshots in both colour schemes
(`documentation/agents/verification.md`).
