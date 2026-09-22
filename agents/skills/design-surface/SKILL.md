---
name: design-surface
description: How design work happens in Sefer — the /design route, the point-and-comment collector, variants and tweaks, and how a designer's change reaches the real screens. Use when prototyping a screen, adding or changing a design screen, wiring tweaks onto a real screen, reading a pasted batch of design comments, deploying the prototype, or reviewing a pull request from the designer.
---

# Working on design in Sefer

A designer who is not a developer works in this repository. This skill is the
operating guide: what the tools are, how a remark becomes a change, and what
is deliberately not allowed.

It is **not** a design guide. Voice, brand, typography, what "quiet" means here
— none of that is settled in this file, and a sentence in here should never be
read as taste. See `agents/skills/README.md`.

Full mechanics: `documentation/architecture/design.md`. This file is what to
do; that file is why it works.

## The mental model in one paragraph

There is one application. `/design` is a route inside it, not a separate app,
so a prototype is built from the real components against the real tokens. A
floating panel sits on **every** route — comment-only out on the real screens,
and reconfigured with variants and tweaks when you are on `/design`. Everything
the panel sets lives in the URL, so "look at this" is a link. A build either
carries the whole surface or none of it, decided by one Vite `define`, and
production never does.

## Three builds

| Command | `/design` | Panel | `data-loc` stamps |
| --- | --- | --- | --- |
| `pnpm dev` | yes | yes | yes |
| `pnpm build:dev` | yes | yes | yes |
| `pnpm build` | **no** | **no** | **no** |

The middle one is the deployed prototype — a production build in every respect
except that it carries the surface. That is why the switch is
`--mode dev` and not `import.meta.env.DEV`.

**Gate on `__SEFER_DESIGN__` directly, never through an imported constant.** An
exported constant folds at its use site and rolldown still shipped the design
page as an orphaned chunk. `pnpm verify:design` proves both directions against
real builds; run it after touching the gate.

## The comment collector

The panel's whole job is turning "this padding is wrong" into something an
agent can act on.

**How it works.** Switch to Comment mode (the segmented control, or `c` on
`/design`). The mode is total: every event is taken in the capture phase, so
the application cannot be operated while it is on — that is deliberate, because
a half-mode where some clicks fall through produces bug reports about the app
being broken. Hover outlines the element; click opens a composer. `Esc` cancels
the composer, `Esc` again leaves the mode.

**Enter copies.** A plain Enter saves the comment *and* puts the batch on the
clipboard — Enter is a user gesture, which is what the clipboard API wants, so
the whole loop is click, type, Enter, paste. Shift+Enter is a newline. "Add to
batch" saves without copying, for a sweep of several notes and one Copy at the
end.

**What a comment carries.** A source location first — `data-loc` is stamped
onto every intrinsic JSX element in dev and design builds by
`tools/vite/jsxLocation.ts`, and it is the difference between a note you can
act on and one you have to grep for. Then the element's own text (only its own
— a container says nothing rather than concatenating its descendants), its
`data-*` attributes, and the URL. A pasted batch reads:

```
http://localhost:3210/design?primitives.size=sm

1. src/app/ui/primitives/Button.tsx:77:5  "tertiary"
   too faint against the card.
```

**Two channels, and both matter.** The paste works everywhere, including a
product owner on a laptop three time zones away. When an agent is attached over
CDP (`pnpm verify:chrome`) it can instead call
`globalThis.__sefer.design.drain()` — the Copy button minus the clipboard — and
nobody pastes anything. Use the handle when it is available; never assume it is.

**The collector is framework-agnostic on purpose.** `src/dev/annotate/` is a
plain DOM module under `src/core`'s own boundary rules: no `solid-js`, no
router, no Sefer. It talks to its host through a `StateAdapter` — read and
write a flat string map — which here is the URL and elsewhere could be
anything. Do not import a framework into that folder; `pnpm boundaries` will
fail you, and the point is that the folder can be lifted into another
repository as a copy.

## Variants and tweaks

A **variant** is a whole alternative take on a page — what the segmented
control switches between — and owns its own tweaks. A **tweak** is one small
named change. Tweaks declared on the screen itself apply whichever variant is
showing and survive the switch.

Both live in the URL, namespaced so two screens cannot collide:

```
/design?screen=onboarding&onboarding.v=cards&onboarding.density=tight
```

Rules that are easy to get wrong:

* Toggles are `on`/`off`, never `true`/`false`. TanStack serialises search
  params as JSON, so the string `"false"` is written quoted (`%22false%22`) —
  correct on the round trip, unreadable in a link, and un-editable by hand.
* A value at its declared default is **dropped** from the URL, not written. A
  link carrying every default is one nobody can read the interesting part of.
* Switching variant drops the outgoing variant's own tweaks and keeps the
  shared ones.

### From anywhere, not just from `/design`

A real screen can borrow the panel without being copied into
`src/dev/design/screens/` first — by the time a copy exists it is a different
file from the one that ships, and whatever you learn has to be carried back by
hand.

```ts
if (import.meta.env.DEV) {
  globalThis.__sefer?.design?.register({
    namespace: "bookEditor",
    tweaks: [{ key: "gutter", label: "Gutter", kind: "choice", options: ["narrow", "wide"] }],
    onChange: (values) => { setGutter(values["bookEditor.gutter"] ?? "narrow"); },
  });
}
```

Through the global rather than an import, because `pnpm boundaries` forbids
`src/app` importing `src/dev` — and a global that does not exist in production
is not an import. `onChange` fires once on registration and again on every
turn, so its body is a `setSignal`.

**This is scaffolding and it has an expiry.** It is inert in any build without
the design surface, so it cannot break anything; what it does is accumulate.
`pnpm design:scaffolding` lists what is still there. `pnpm lint:release` makes
it an error, and `tools/deploy/web.ts` runs that before **preview and production**
and not before `dev` — because scaffolding is exactly what `dev` is for.
Settle the question, then remove the scaffolding.

## Data: real first, mocks where they earn it

Screens split by whether they need scripture.

**Data-free** — onboarding, settings, the project list, empty and error states.
These need nothing, they are most of what polish touches, and they run anywhere
including a deployed worker with no filesystem. Mocked data is fine here.

**Data-bearing** — editor, review, inventory, terms. Prefer real text. A
designer judging line length and density on lorem ipsum produces a layout that
breaks on long book names, on Greek, and on Hebrew — and this application is
made of exactly those. The playground (`/project/$slug/playground`) already
hands experiments real books and the real engine; use it when the question is
about text.

The rule of thumb: **mock what you are not looking at, never what you are
looking at.** A mocked project list behind a dialog you are positioning is
fine. Mocked scripture in a screen about how scripture reads is not.

## The workflow, and what it is for

1. **Try it.** A committed screen in `src/dev/design/screens/`; a throwaway in
   `src/dev/design/local/`, which is gitignored and never appears in a diff.
   Or register tweaks on the real screen in place.
2. **Share it.** Copy the URL. It carries the screen, the variant and every
   tweak, so "compare a against b" is two links.
3. **Say what is wrong.** Comment mode, then paste — or let the agent drain it.
4. **Graduate it.** A variant that wins **moves into the real screen**.

Step 4 is the whole point and the thing most likely to be skipped. The design
surface is a staging area, not a parallel application. A prototype that lives
in `src/dev` forever has recreated the problem this replaced — work that looks
like the product and diverges from it every week.

### Reviewing the designer's work

* **He owns** feel, polish, motion, hierarchy, density, spacing, and colour
  within the semantic tokens. Those are his calls; do not relitigate them in
  review.
* **Review is for** fit with the architecture, the developer idiom, the
  boundaries, naming, and the single Solid/Book subscription rule.
* **Two bars, two folders.** `src/dev/**` answers a question. It should still
  be good, and it is written by somebody who does not think like a developer;
  it is not held to the shipping bar. `src/app/ui/**` is.
* A diff touching only `src/dev/**` is nearly review-free by construction — the
  boundary checks already prove it cannot reach the application.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev` | Dev server; `/design` and the panel are on |
| `pnpm build:dev` | The deployed prototype build |
| `pnpm deploy:web design --dry` | Build and print what would ship |
| `pnpm verify:design` | Proves the surface is in the design build and out of production |
| `pnpm boundaries` | The three path rules |
| `pnpm design:scaffolding` | Lists scaffolding still in application code (exits 0) |
| `pnpm lint:release` | Makes that scaffolding an error |
| `pnpm verify:chrome` | Headless Chrome with CDP, for driving the app and reading the handle |

## The debug handle

`globalThis.__sefer.design`, beside the observability handle:

| Call | Gives |
| --- | --- |
| `declarations()` | The knobs that exist — the one thing a URL cannot carry |
| `values()` | What is set, i.e. the URL |
| `set(key, value)` | Turn one |
| `comments()` / `drain()` | The batch; `drain` reads and clears |
| `mode()` / `setMode()` | The pointer |
| `register(...)` | Scaffolding, above |
