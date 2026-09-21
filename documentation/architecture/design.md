# The design surface

A designer who is not a developer works in this repository. This is how, what
stops his work reaching a release, and which switch decides.

Read this before touching `src/dev/design`, `src/dev/annotate`,
`src/routes/design.tsx`, or the `__SEFER_DESIGN__` define in `vite.config.ts`.

## There are three builds, not two

| Command | Mode | `/design` | Annotator | `data-loc` |
| --- | --- | --- | --- | --- |
| `pnpm dev` | `development` | yes | yes | yes |
| `pnpm build:design` | `design` | yes | yes | yes |
| `pnpm build` | `production` | **no** | **no** | **no** |

The middle row is the one that needs explaining. The deployed prototype — the
URL a designer sends a product owner — is a PRODUCTION build in every sense
that matters: minified, served from a worker, no dev server. So
`import.meta.env.DEV` would switch the design surface off exactly where it is
wanted. `vite build --mode design` makes a third build that is production in
every respect except that it carries the surface.

A CLI flag rather than a `VITE_` variable, deliberately. An env file is a piece
of state on somebody's machine that can drift out of step and end up switching
this on in a real release; a flag on a deploy job cannot. There is no
`INCLUDE_DESIGNER` variable and there should not be one — it would be a second
name for the same idea and a second thing to keep in step.

### The switch is a `define`, and that is load bearing

```ts
// vite.config.ts
const designBuild = mode === "development" || mode === "design";
define: { __SEFER_DESIGN__: JSON.stringify(designBuild) }
```

It was an exported `DESIGN_ENABLED` constant first, and that was subtly wrong.
The gate folded correctly — the route compiled down to `throw notFound()` — and
rolldown emitted the design page as an orphaned chunk anyway: unreachable, and
shipped. `/dev/fixture` has never had the problem because it writes
`import.meta.env.DEV` inline, which is a literal before any of that. A `define`
is the same kind of literal at every use site.

So: **gate with `__SEFER_DESIGN__` directly, never through an imported
constant.**

`pnpm verify:design` checks the claim against two real builds rather than
trusting this document. It looks for a sentinel rendered into the design page
and expects it absent from `production` and present in `design`. Run it after
touching the gate.

## What is where

| Path | What it is |
| --- | --- |
| `src/routes/design.tsx` | The gated route. Loose `validateSearch`: every string key is kept. |
| `src/dev/design/` | The screens, and the frame that renders them. May use the real components — that is the point. |
| `src/dev/design/screens/` | Committed screens. Travel with the repository. |
| `src/dev/design/local/` | Gitignored sketches. Appear in the picker on save, never in a diff. |
| `src/dev/annotate/` | The floating panel. A plain DOM module; see below. |
| `src/dev/designSurface.ts` | Mounts the one annotator app-wide, installs the debug handle. |
| `tools/vite/jsxLocation.ts` | Stamps `data-loc="file:line:col"` on intrinsic JSX. |

## Three boundary rules, all in `pnpm boundaries`

1. **Nothing outside `src/dev` may statically import `src/dev`.** The route
   gates are the bundling guarantee; this is the architectural one, and they
   are different claims. A dynamic `import()` is allowed, because a dynamic
   import inside a build-time branch is exactly how the gates are written.
2. **`src/dev/annotate` gets `src/core`'s own rule set** — no framework
   packages, no Node builtins, nothing outside itself. "Liftable into another
   repository as a folder copy" and "imports no framework" are the same
   sentence, and `solid-js` there fails the build.
3. `src/core`'s original rule, unchanged.

## The annotator

One instance, mounted from `src/routes/__root.tsx`, on **every** route. A
remark like "this input does not autofocus when the dialog opens" is about a
real screen, and pointing at a pixel should work wherever the pixel is.

* On a real screen: comment-only, minimised to a puck, **no hotkey** (a bare
  `c` over CodeMirror competes with the editor).
* On `/design`: the same panel, reconfigured with that screen's variants and
  tweaks, opened, hotkey `c`.

Production never has it, and that is not negotiable: comment mode swallows
every event in the capture phase, which in the hands of somebody editing
scripture is a foot-gun.

### Variants and tweaks

A **variant** is a whole alternative take on a page — what a segmented control
switches between — and owns its own tweaks. A **tweak** is one small named
change. Tweaks declared on the screen itself apply whichever variant is
showing and survive the switch.

All of it lives in the URL, namespaced:

```
/design?screen=onboarding&onboarding.v=cards&onboarding.density=tight
```

Toggles are `on`/`off`, never `true`/`false`: TanStack serialises search params
as JSON, so the string `"false"` is written quoted (`%22false%22`) — correct on
the round trip, unreadable in a link, and un-editable by the designer who is
supposed to be able to hand-edit it. A value at its declared default is dropped
from the URL rather than written, because a link carrying every default is one
nobody can read the interesting part of.

### Scaffolding on a real screen

A real screen can borrow the panel without becoming a design screen:

```ts
if (import.meta.env.DEV) {
  globalThis.__sefer?.design?.register({
    namespace: "bookEditor",
    tweaks: [{ key: "gutter", label: "Gutter", kind: "choice", options: ["narrow", "wide"] }],
    onChange: (values) => { setGutter(values["bookEditor.gutter"] ?? "narrow"); },
  });
}
```

Through the global rather than an import, because rule 1 forbids the import and
a global that does not exist in production is not one. `onChange` fires once on
registration and again on every turn, so its body is a `setSignal` — the
annotator never learns what a signal is.

**This is temporary code by construction.** It cannot break production, because
the handle is not there; what it does is accumulate. `pnpm design:scaffolding`
lists every place it is still sitting. It exits 0 either way — a gate would
just teach people to avoid the pattern rather than tidy up after it.

## The debug handle

`globalThis.__sefer.design`, alongside the observability handle:

| Call | What it gives |
| --- | --- |
| `declarations()` | The knobs that EXIST — the one thing a URL cannot carry |
| `values()` | What is set, i.e. the URL |
| `set(key, value)` | Turn one |
| `comments()` / `drain()` | The batch; `drain` is Copy minus the clipboard |
| `mode()` / `setMode()` | The pointer |
| `register(...)` | See above |

`drain()` is why it exists: an agent attached over CDP (`pnpm verify:chrome`)
can read a batch and never make anybody paste. The paste stays the channel that
works everywhere else — a deployed prototype, a product owner three time zones
away — so it is a shortcut, not a replacement.

## Source locations

`tools/vite/jsxLocation.ts` stamps `data-loc="src/app/ui/Foo.tsx:42:7"` on
every intrinsic JSX element in dev and design builds. It is the difference
between a comment an agent can act on and one it has to grep for.

Nothing upstream provides it — checked against what is installed, not assumed.
`@solidjs/babel-plugin` contains no occurrence of "location";
`@solidjs/vite-plugin` exposes no option; `@tanstack/router-plugin` stamps
nothing (its Devtools' "open in editor" is route-FILE granularity, from the
generator's `filePath`); `@solid-devtools/debugger` reads an `sdtLocation` set
by a transform we do not install, and that is component-level anyway.

It runs `enforce: "pre"`, because the Solid transform erases JSX and after it
there is nothing left to stamp, and it is a text insertion rather than a
re-print, so the worst a bug in it can do is add or miss one attribute.

**Intrinsic elements only.** Stamping `<Card>` passes `data-loc` as a prop, and
most components never spread unknown props onto a DOM node, so it would vanish
— inconsistently, which is an hour of somebody's afternoon. A click resolves to
the nearest ancestor carrying it, which lands on the real element the component
rendered.

## Working with the designer

The arrangement, written down because one nobody wrote down is one that gets
relitigated:

* **The designer owns** feel, polish, motion, hierarchy, density, spacing, and
  colour within the semantic tokens.
* **Review is for** fit with the architecture, the developer idiom, the
  boundaries, naming, and the single-subscription rule — not for taste that was
  his call to make.
* **Two bars, two folders.** Code under `src/dev/**` answers a question. It
  should still be good, and it is written by somebody who does not think like a
  developer; it is not held to the shipping bar. `src/app/ui/**` is.
* **Mocked data is acceptable** on screens that need none. Real text is
  preferred wherever it is available.
* **Graduation is expected.** A variant that wins moves into the real screen.
  The design surface is a staging area, not a parallel application — that
  divergence is the failure this whole thing exists to avoid.
