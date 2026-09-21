# The design surface

A designer who is not a developer needs to try UI ideas against the real
application, share what he tried by URL, and point at a pixel and say what is
wrong with it in a way another agent can act on. Today that happens in Claude
Design, deployed as artifacts, and the result diverges from the application
within a week because nothing he makes is the application.

This plan brings it into the repository. It is deliberately NOT a long-lived
design branch: a branch that must be rebased weekly by somebody who does not
use git is a tax with a known failure mode. The isolation is a PATH, not a
branch, and a static check enforces it.

## Stage 0 — TypeScript 7, and what it costs

`typescript@7.0.2` is `latest`; the compiler is the native port and it is much
faster. The catch is that the package no longer exports the old JS API:

```
"exports": { ".": "./lib/version.cjs", "./unstable/ast": …, "./unstable/sync": … }
```

`import ts from "typescript"` now yields a version string. The repository has
exactly ONE consumer of the compiler-as-a-library — `tools/boundaries/check.ts`,
which walks a TypeScript AST to collect import specifiers. It must be ported
before the bump, or `pnpm boundaries` dies.

Port it to **oxc-parser** rather than to `typescript/unstable/ast`:

  * `oxc-parser` is native and fast, and `oxlint`/`oxfmt` already make oxc the
    family this repository reads its own source with;
  * the JSX-location plugin in stage 4 needs a parser with byte spans anyway,
    so this is one parser for both tools rather than two;
  * `unstable/ast` is named `unstable` for a reason and the boundary check is
    in the CI gate.

The walker's shape does not change: collect every import/export/require/
`import()`/`import.meta.glob` specifier with a position, then apply the rules.
Only the parse and the node predicates change.

## Stage 1 — The design boundary, checked

Two new rules in `tools/boundaries/check.ts`, reusing the same walker:

  * **Nothing outside `src/dev/` imports from `src/dev/`.** This is what makes
    the path rule real. The route-level `import.meta.env.DEV` gate is a
    BUNDLING guarantee; this is the ARCHITECTURE guarantee, and they are
    different claims.
  * **`src/dev/annotate/` imports nothing from `src/core/` or `src/app/`.** The
    comment overlay is a DOM tool. Keeping it ignorant of Sefer is what lets it
    be lifted into another repository as a folder copy. `src/dev/design/`, which
    holds the screens, is under no such rule — it is supposed to reach for the
    real components, and it is the folder the designer actually lives in.

Both run inside `pnpm boundaries`, which is already in `pnpm check` and in CI.
`import.meta.glob` specifiers are collected by the existing walker, which
matters because the playground registry globs its experiments.

## Stage 2 — A third build mode

`/design` must exist in the deployed prototype and must not exist in
production. That is three modes, not two:

```
pnpm build:design    # vite build --mode design
```

and one Vite `define` that every design route's `beforeLoad` consults:

```ts
__SEFER_DESIGN__: JSON.stringify(mode === "development" || mode === "design")
```

A `define` rather than an exported constant, and that is not a style choice.
It was an exported `DESIGN_ENABLED` first: the gate folded correctly and the
route compiled down to `throw notFound()`, and rolldown emitted the design
page as an orphaned chunk anyway — unreachable, and shipped. `/dev/fixture`
has never had the problem because it writes `import.meta.env.DEV` inline,
which is a literal before any of that. A CLI flag rather than a `.env` value,
so it cannot be switched on by a stale file on somebody's machine, and
`pnpm verify:design` checks both directions against real builds.

Deploy on every push to master. The staleness the long branch would have
created stops existing: the prototype IS master.

## Stage 3 — The design routes, and what they are allowed to need

Split by whether a screen needs scripture:

  * **Data-free** — onboarding, settings, the project list, empty and error
    states. These need nothing, they are most of what polish touches, and they
    are what ships first.
  * **Data-bearing** — editor, review, inventory, terms. These need real text.

For the data-bearing tier the design build seeds ONE well-known project at a
FIXED slug, so `$slug` is a constant in that build and every URL is shareable
end to end. Text is fetched lazily from a static asset rather than from DCS at
runtime: a demo URL in front of a product owner must not break because a
server is slow. `publicDir` is copied wholesale by Vite, so whether the desktop
build carries the same text is a deliberate decision, not a discovery.

Mocked data is acceptable on the data-free tier. Real text is preferred
everywhere it is available.

### Tweaks live in the URL

The playground's dials are `sessionStorage` today, and `PlaygroundPage.tsx`
argues for that in a module comment: "not a place anyone should link to."
Sharing is now the requirement, so that decision inverts and the comment must
say so rather than be silently contradicted.

TanStack Router is already here, so the search params ARE the reactive signal:
`useSearch()` to read, `navigate({ search })` to write. Back/forward, copy,
paste and "compare a against b" all come free. Readable params first
(`?layout=table&density=tight`) because the designer edits them by hand and
pastes them into chat. The backing store is already `Record<string, string>`,
which is query-param shaped, so `Dial` and `DialValues` do not change.

`sessionStorage` keeps the things nobody links to — which experiment was open.

## Stage 4 — Point and prompt

A floating, minimisable overlay with a mode switch: **interact | comment |
copy**.

  * Comment mode is a MODE. It intercepts every event in the capture phase, so
    the application cannot be operated while it is on, and it is loudly
    obvious — crosshair plus a tinted viewport border — because a mode you can
    forget you are in generates bug reports about the application being broken.
    `Esc` always leaves.
  * Hovering outlines the element beneath; clicking opens a box.
  * Comments batch. Copying puts markdown on the clipboard and clears the
    active list, keeping the last batch restorable, because a misclick should
    not cost ten minutes of writing.
  * Two verbosity levels, not three. Brief is a header line (URL, build) and
    then per comment a source location and the text — most comments are "this
    padding is wrong" and the location is the entire payload. Full adds
    viewport, theme, selector and nearby text.
  * The overlay renders through a portal into `document.body` under its own
    namespace, so changing the tokens under evaluation cannot restyle the tool
    evaluating them.
  * Comments survive HMR in `sessionStorage`.

### The source location

Verified against what is installed: `@solidjs/babel-plugin@2.0.0-rc.6`
contains no occurrence of "location" at all, `@solidjs/vite-plugin@3.0.0-next.38`
exposes no option for it, and the `@solid-devtools/debugger` in the store reads
`owner.sdtLocation`, which is set by a transform that is not installed and is
component-level regardless. Solid 2 does not stamp JSX locations. We write it.

A `pre`-enforced Vite plugin, on the raw `.tsx` before the Solid transform
erases JSX:

  * parse with `oxc-parser`, walk JSX opening elements, splice
    `data-loc="src/app/ui/Foo.tsx:42:7"` in at the span offset with
    `magic-string` — a text insertion, not a re-print, so there is no codegen
    and the sourcemap comes free;
  * INTRINSIC elements only. Stamping `<MyCard>` passes a prop most components
    never spread onto a DOM node, so it would silently vanish; a click resolves
    to the nearest ancestor carrying `data-loc`, which is the wanted behaviour;
  * Solid hoists static attributes into the template string, so this costs
    nothing at runtime;
  * dev and design modes only.

This is worth building on its own account — it improves the developer loop
whatever happens with the design arrangement — which is also the argument for
keeping `src/dev/annotate/` free of Sefer specifics from the first commit
rather than extracting it later.

## Stage 5 — The handoff, written down

A top-level pointer, because an arrangement nobody wrote down is an
arrangement that gets relitigated:

  * **The designer owns** feel, polish, motion, hierarchy, density, spacing and
    colour within the semantic tokens.
  * **Review is for** fit with the architecture, the developer idiom, the
    boundaries, naming and the single-subscription rule — not for taste that
    was his call to make.
  * **Two bars, two folders.** `src/dev/**` answers a question; it should still
    be good, but it is written by somebody who does not think like a developer
    and it is not held to the shipping bar. `src/app/ui/**` is.
  * **Graduation is expected.** A variant that wins moves into the real screen.
    The design surface is a staging area, not a parallel application — that
    divergence is the failure this whole plan exists to avoid.

## Order

1. ~~oxc port of the boundary walker, then TypeScript 7.~~ **Done** — `7fa1c3d`.
2. ~~The two design boundary rules.~~ **Done** — `a35791f`.
3. ~~Design mode, the build script, the route gate.~~ **Done** — `8114173`.
4. ~~URL params on the existing playground dials.~~ **Done** — `aa1cbd8`.
5. ~~The overlay, DOM capture only.~~ **Done** — the floating panel, with
   variants and tweaks moved into it and the header bar removed.
6. ~~The oxc JSX-location plugin, wired into the overlay.~~ **Done**.
7. The seeded text for the data-bearing tier.
8. The handoff document.

Each step is useful alone, which matters because 6 is the one that might not
land cleanly.

## Open, and deliberately not decided

A `/design` screen renders inside the application's icon rail, because the
root layout wraps every route and there is no per-route escape from it without
restructuring into a pathless layout. That is FAITHFUL for a screen which
really does live inside the rail, and wrong for onboarding, which does not.
The playground escapes it only because it supplies its own `ShellGate` and
sits below a route that has already taken the chrome off.

Left alone rather than guessed at. If it wants fixing the cheap version is a
frame-level dial — `?chrome=0` — rather than a new layout.
