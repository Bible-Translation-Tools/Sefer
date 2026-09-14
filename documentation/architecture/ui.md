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
the editor module. It consumes the same tokens and is not part of this layer.

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
