# The design surface

A designer who is not a developer works in this repository. This is how, what
stops his work reaching a release, and which switch decides.

Read this before touching `src/dev/design`, `src/dev/annotate`,
`src/routes/design.tsx`, or the `__SEFER_DESIGN__` define in `vite.config.ts`.

## There are three builds, not two

| Command          | Mode          | `/design` | Annotator | `data-loc` |
| ---------------- | ------------- | --------- | --------- | ---------- |
| `pnpm dev`       | `development` | yes       | yes       | yes        |
| `pnpm build:dev` | `dev`         | yes       | yes       | yes        |
| `pnpm build`     | `production`  | **no**    | **no**    | **no**     |

The middle row is the one that needs explaining. The deployed prototype — the
URL a designer sends a product owner — is a PRODUCTION build in every sense
that matters: minified, served from a worker, no dev server. So
`import.meta.env.DEV` would switch the design surface off exactly where it is
wanted. `vite build --mode dev` makes a third build that is production in
every respect except that it carries the surface.

A CLI flag rather than a `VITE_` variable, deliberately. An env file is a piece
of state on somebody's machine that can drift out of step and end up switching
this on in a real release; a flag on a deploy job cannot. There is no
`INCLUDE_DESIGNER` variable and there should not be one — it would be a second
name for the same idea and a second thing to keep in step.

### The switch is a `define`, and that is load bearing

```ts
// vite.config.ts
const designBuild = mode === "development" || mode === "dev";
define: {
  __SEFER_DESIGN__: JSON.stringify(designBuild);
}
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
and expects it absent from `production` and present in `dev`. Run it after
touching the gate.

## What is where

| Path                        | What it is                                                                                     |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/routes/design.tsx`     | The gated route. Loose `validateSearch`: every string key is kept.                             |
| `src/dev/design/`           | The screens, and the frame that renders them. May use the real components — that is the point. |
| `src/dev/design/screens/`   | Committed screens. Travel with the repository.                                                 |
| `src/dev/design/local/`     | Gitignored sketches. Appear in the picker on save, never in a diff.                            |
| `src/dev/annotate/`         | The floating panel. A plain DOM module; see below.                                             |
| `src/dev/designSurface.ts`  | Mounts the one annotator app-wide, installs the debug handle.                                  |
| `tools/vite/jsxLocation.ts` | Stamps `data-loc="file:line:col"` on intrinsic JSX.                                            |

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

It stays on the ROOT rather than moving down with the workspace chrome into
`_app.tsx`, and that placement is the point of it: a comment about a real
screen and a comment about a prototype are the same gesture, and a panel that
existed only inside one frame would be a panel you cannot use to compare them.
`/design` therefore has no rail and no status line but does have the panel.

- On a real screen: comment-only, minimised to a puck, **no hotkey** (a bare
  `c` over CodeMirror competes with the editor).
- On `/design`: the same panel, reconfigured with that screen's variants and
  tweaks, opened, hotkey `c`.

Those are defaults, not a ceiling. A chord RECORDED in the panel (kebab →
`hotkey: …`) is kept in `localStorage` and outranks both, a recorded "none"
included — which is how the hotkey comes back on over a real screen, since
`⌥C` collides with nothing the way a bare letter does. `src/dev/annotate/
hotkey.ts` matches on `event.code`, because macOS turns Option+C into
`event.key === "ç"` and matching on `key` would fail for exactly the chords
worth recording.

A comment is about one or more **targets**: a plain click composes, Shift+click
gathers. Each target carries its own `data-loc`, selector, own text and
`data-*`, gets a numbered pin drawn from its live rect (comment mode only), and
appears as `[n]` in the paste under one shared sentence. The numbering runs
across the batch rather than per comment, so the pin and the paste agree —
without that, "move 1 to where 2 is" has nothing to refer to.

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
if (__SEFER_DESIGN__) {
  globalThis.__sefer?.design?.register({
    namespace: "bookEditor",
    tweaks: [{ key: "gutter", label: "Gutter", kind: "choice", options: ["narrow", "wide"] }],
    onChange: (values) => {
      setGutter(values["bookEditor.gutter"] ?? "narrow");
    },
  });
}
```

`__SEFER_DESIGN__` and not `import.meta.env.DEV`, for the reason this file
opens with: the deployed prototype is a production build, so `DEV` is false
there. A tweak gated on `DEV` works on a laptop and is silently absent on the
one build somebody was sent a link to.

Through the global rather than an import, because rule 1 forbids the import and
a global that does not exist in production is not one. `onChange` fires once on
registration and again on every turn, so its body is a `setSignal` — the
annotator never learns what a signal is.

**This is temporary code by construction**, and there are two nets under it.

`pnpm design:scaffolding` lists every place it is still sitting, and exits 0
either way — it is a reminder you can run any time.

`pnpm lint:release` turns `anti-slop/no-design-scaffolding` into an error.
That rule is not enabled in `oxlint.config.ts` on purpose —
`oxlint.release.config.ts` is what sets it — a squiggle under code
somebody is actively iterating with is how a rule teaches people to disable
it. `tools/deploy/web.ts` runs it before every production-mode build — `preview`
and `production` — and `dev` does not, because
scaffolding is exactly what `dev` is for. The scaffolding is
inert in any build without the design surface, so this is hygiene rather than
correctness; a release is simply the moment by which the question it was
answering should be settled.

`src/dev` is exempt from the rule: that is where the surface lives.

## The debug handle

`globalThis.__sefer.design`, alongside the observability handle:

| Call                     | What it gives                                           |
| ------------------------ | ------------------------------------------------------- |
| `declarations()`         | The knobs that EXIST — the one thing a URL cannot carry |
| `values()`               | What is set, i.e. the URL                               |
| `set(key, value)`        | Turn one                                                |
| `comments()` / `drain()` | The batch; `drain` is Copy minus the clipboard          |
| `mode()` / `setMode()`   | The pointer                                             |
| `register(...)`          | See above                                               |

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

- **The designer owns** feel, polish, motion, hierarchy, density, spacing, and
  colour within the semantic tokens.
- **Review is for** fit with the architecture, the developer idiom, the
  boundaries, naming, and the single-subscription rule — not for taste that was
  his call to make.
- **Two bars, two folders.** Code under `src/dev/**` answers a question. It
  should still be good, and it is written by somebody who does not think like a
  developer; it is not held to the shipping bar. `src/app/ui/**` is.
- **Mocked data is acceptable** on screens that need none. Real text is
  preferred wherever it is available.
- **Graduation is expected.** A variant that wins moves into the real screen.
  The design surface is a staging area, not a parallel application — that
  divergence is the failure this whole thing exists to avoid.

### Nits and explorations are separate commits

The designer produces two things that are reviewed to different standards: a
NIT is a correction to a real screen (`src/app/ui/**`, held to the shipping
bar), and an EXPLORATION is a prototype or scaffolding (`src/dev/**`, nearly
review-free because `pnpm boundaries` already proves it cannot reach the
application).

They must not share a commit. A commit that does both cannot be evaluated at
either bar — in practice the nit is waved through on the exploration's licence,
or the exploration is relitigated at the nit's. `git show --stat` is therefore
the first thing a reviewer reads, and a diff spanning both trees is sent back
to be split before either half is read.

### Graduation is a deletion, by construction

The layout above exists so that retiring a prototype is removing files rather
than editing them. `src/dev/design/registry.ts` finds screens with
`import.meta.glob`, so one screen is one file and NOTHING references it by
name: no index to update, no import to drop, no bookkeeping line in the diff.

A graduation diff should read as whole files deleted under
`src/dev/design/screens/` plus a few lines in `src/app/ui/**` carrying the
winning values plainly. If it instead requires hunting scattered lines out of a
real component, the question was in the wrong lane:

- a **structural** question (cards or a table) is a VARIANT at `/design`,
  because the loser has to disappear completely and a file can;
- a **value** question (how much gutter) may be a tweak registered in place,
  because the answer is a number replacing a number.

**A graduation must not ADD an option.** A real component that emerges with a
`variant` prop or a tweak still being read has imported the prototype's
indecision into the product. What ships is the decision's outcome, not its
apparatus — and the URL in the commit message is how a reviewer opens both and
sees which one won.

**Graduation is deliberately not gated, and that was decided rather than
overlooked.** The two safety directions are not symmetrical. "This cannot break
production" is fully mechanical — the three boundary rules, the `define`, and
`verify:design` — because the cost of getting it wrong is a broken release.
"This should eventually graduate" is left to judgement: a committed screen that
has outlived its question is untidy, not dangerous, and the obvious gate (an
expiry date on `Screen`, failed at release) buys tidiness with a release that
can be blocked by a calendar. Do not add one. Prune screens as the work passes
through them.
