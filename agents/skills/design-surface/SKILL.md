---
name: design-surface
description: How design work happens in Sefer — the /design route, the point-and-comment collector, variants and tweaks, the branch-and-share lifecycle, and how a designer's change reaches the real screens. Use when prototyping a screen, adding or changing a design screen, wiring tweaks onto a real screen, reading a pasted batch of design comments, starting or branching design work, getting a shareable URL for a branch, deploying the prototype, or reviewing a pull request from the designer.
---

# Working on design in Sefer

A designer who is not a developer works in this repository. This skill is the
operating guide: what the tools are, how a remark becomes a change, and what
is deliberately not allowed.

**Assume you are the git.** He should not have to branch, rebase, resolve a
conflict, or work out how to let somebody see a change. Loading this file means
you own all of that — the lifecycle is below, and it is as much a part of the
job as the CSS.

**This file should be enough on its own.** If something he asks for is not
answered here, that is a gap worth saying out loud rather than improvising
around. Two files are deliberately elsewhere:
`documentation/agents/designer-setup.md` for anything about HIS MACHINE
(installs, the dev server, why a commit paused), and
`agents/skills/release-channels/SKILL.md` for shipping beyond a branch preview,
which is not his to do.

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

| Command          | `/design` | Panel  | `data-loc` stamps |
| ---------------- | --------- | ------ | ----------------- |
| `pnpm dev`       | yes       | yes    | yes               |
| `pnpm build:dev` | yes       | yes    | yes               |
| `pnpm build`     | **no**    | **no** | **no**            |

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

**Enter copies.** A plain Enter saves the comment _and_ puts the batch on the
clipboard — Enter is a user gesture, which is what the clipboard API wants, so
the whole loop is click, type, Enter, paste. Shift+Enter is a newline. "Add to
batch" saves without copying, for a sweep of several notes and one Copy at the
end.

**Shift+click gathers.** A plain click comments on one element. Shift+click
collects it and waits, so the next plain click opens ONE composer holding all
of them. "These two should swap" and "move 1 to where 2 is" are among the most
natural things to say about a layout, and they used to cost two comments that
each described half a thought.

Every collected place gets a number, painted on a pin at the element's corner
and printed as `[2]` in the paste. The same number in both is the point — it is
what lets the sentence refer to them. Pins are drawn from the live element's
rect, so they follow scrolling and reflow; they show only in comment mode, and
only for this page visit (the comments survive a reload, the pins do not).

**The hotkey is recordable.** Kebab → `hotkey: …` → press the keys. It is
stored per browser in `localStorage` and outranks whatever the host passed,
including a recorded "none" (`⌫` while recording). This is how the hotkey gets
turned back ON over a real screen: `⌥C` is safe over CodeMirror in a way a bare
`c` is not. Matching is on `event.code`, because macOS turns Option+C into
`event.key === "ç"`.

**What a comment carries.** A source location first — `data-loc` is stamped
onto every intrinsic JSX element in dev and design builds by
`tools/vite/jsxLocation.ts`, and it is the difference between a note you can
act on and one you have to grep for. Then the element's own text (only its own
— a container says nothing rather than concatenating its descendants), its
`data-*` attributes, and the URL. A pasted batch reads:

```
## http://localhost:3000/design?primitives.size=sm

[1] src/app/ui/primitives/Button.tsx:77:5  "tertiary"
    too faint against the card.

[2] src/app/ui/primitives/Button.tsx:77:5  "primary"
[3] src/app/ui/primitives/Button.tsx:77:5  "secondary"
    these two should swap.

## http://localhost:3000/project/small-nt/terms

[4] src/app/ui/excerpts/StetView.tsx:31:7  "Key terms"
    this heading should match the rail.
```

Numbering runs across the whole batch, not per comment, so `[3]` in the paste
is the pin marked `3` on the screen.

**The URL is printed whenever it CHANGES**, so one batch can span a walk
through the application — three remarks on the project list, two on key terms,
one in the editor — and still say where each was made. The panel survives a
client-side navigation, so that walk is the normal case rather than a trick.

**Verbosity is a render-time filter, not a capture setting.** A comment always
stores everything it could say; `brief` and `full` (the switch beside Copy)
only choose what the paste prints, so flipping it after a sweep re-renders what
is already there. `full` adds the selector, the viewport and the theme, and is
the default on a DEPLOYED design build — where whoever reads the paste cannot
open the checkout and look.

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

- Toggles are `on`/`off`, never `true`/`false`. TanStack serialises search
  params as JSON, so the string `"false"` is written quoted (`%22false%22`) —
  correct on the round trip, unreadable in a link, and un-editable by hand.
- A value at its declared default is **dropped** from the URL, not written. A
  link carrying every default is one nobody can read the interesting part of.
- Switching variant drops the outgoing variant's own tweaks and keeps the
  shared ones.

### From anywhere, not just from `/design`

A real screen can borrow the panel without being copied into
`src/dev/design/screens/` first — by the time a copy exists it is a different
file from the one that ships, and whatever you learn has to be carried back by
hand.

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

Through the global rather than an import, because `pnpm boundaries` forbids
`src/app` importing `src/dev` — and a global that does not exist in production
is not an import. `onChange` fires once on registration and again on every
turn, so its body is a `setSignal`.

Gate on `__SEFER_DESIGN__`, **not** `import.meta.env.DEV`. The deployed
prototype is a production build (`--mode dev`), so `DEV` is false there — a
tweak gated on it works on a laptop and is silently absent on the one build
you sent somebody a link to.

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

## Where tweaks and variants are written

Three lanes. They are ranked here by **how cleanly they delete**, because
deleting them is the last step of every one of them, and that is the property
worth optimising for.

| Lane      | Lives in                                  | Graduating costs                 |
| --------- | ----------------------------------------- | -------------------------------- |
| Throwaway | `src/dev/design/local/*.tsx` (gitignored) | nothing — it was never committed |
| Prototype | `src/dev/design/screens/<screen>.tsx`     | `git rm` the file                |
| In place  | `register(...)` inside a real component   | hand-editing the real file       |

**One screen is one file, and nothing links to it.** `registry.ts` finds
screens with `import.meta.glob`, so adding one is adding a file and removing
one is removing a file. There is no index to update, so there is no index to
forget, and a graduation diff has no bookkeeping line in it to argue about.

**Prefer the lane that deletes.** That gives a decision procedure for where a
question goes:

- A **structural** question — cards or a table, one column or two, does this
  step exist — is a VARIANT at `/design`. It is a whole alternative take and
  the loser has to disappear completely, so it wants to be a file.
- A **value** question — how much gutter, which weight, how tight — can be a
  tweak registered on the real screen, because the answer is a number that
  replaces a number and the scaffolding around it is a handful of lines.

Putting a structural question on a real screen is how a real component grows a
`variant` prop that outlives the decision. That is the failure this ranking
exists to prevent.

## Two kinds of commit, never in one commit

The designer produces two different things, and they are reviewed to two
different standards:

- **A nit** — a correction to a real screen. Touches `src/app/ui/**`. Held to
  the shipping bar.
- **An exploration** — a prototype, a mock, scaffolding. Touches **only**
  `src/dev/**`. Nearly review-free by construction: `pnpm boundaries` already
  proves it cannot reach the application.

**Keep them in separate commits.** A commit that does both cannot be evaluated
at either bar — in practice the nit gets waved through on the exploration's
licence, or the exploration gets relitigated at the nit's bar. Neither is the
review anybody wanted.

A reviewer's first move is therefore `git show --stat`:

- all paths under `src/dev/**` → an exploration; read it for sense, not for fit
- all paths under `src/app/ui/**` → a nit; review it properly
- **both** → ask for it split before reading either

## Graduating: it should read as a deletion

A variant that wins moves into the real screen, and the diff that does it has
a recognisable shape:

- **whole files deleted** under `src/dev/design/screens/`
- **a few changed lines** in `src/app/ui/**` — the winning values, written
  plainly as the only thing the component does
- **nothing else** — no index to update, no import to drop, because the
  registry is a glob

If graduating something means hunting through a real component for scattered
lines, the question was in the wrong lane. That is a signal about the lane, not
a reason to do the hunting.

**The anti-pattern is a graduation that ADDS an option.** A real component that
comes out of this with a `variant` prop, a `density` setting, or a tweak still
being read has imported the prototype's indecision into the product. The
product renders one thing. The decision was made on `/design`; what ships is
its outcome, not its apparatus.

**Which one won is answerable from the link.** The URL carries the screen, the
variant and every tweak at a non-default value, so a graduation commit should
name the URL it is graduating. That is the difference between "we picked the
tighter one" and a reviewer who can open both and see.

Graduating — step 4 of the four steps below — is the whole point and the thing
most likely to be skipped. The design
surface is a staging area, not a parallel application. A prototype that lives
in `src/dev` forever has recreated the problem this replaced — work that looks
like the product and diverges from it every week. `pnpm design:scaffolding`
lists the in-place lane that has outstayed its question; `pnpm lint:release`
turns it into an error before preview and production.

## The lifecycle: branch, push, share, graduate

The designer does not work on `master` and should never resolve a merge. As
the agent, you own the git so he does not have to.

**1. Always start from a fresh `master`.**

```sh
git checkout master && git pull
git checkout -b design/onboarding-cards
```

Every piece of work, even when the last one is an hour old. Branching from
current `master` each time is what keeps a rebase from ever being necessary —
somebody else may be committing a dozen times a day.

**If a branch has fallen behind far enough to conflict, do not fight it.**
Start a fresh branch from `master` and bring the change across. That takes
minutes; teaching a designer to resolve a merge does not.

**2. His long-lived branch is a SKETCHBOOK, not a merge source.** He may keep
one — `th`, `design` — full of ideas. Read from it and rewrite against today's
code when he says _"reuse the card layout from my `th` branch"_. Never merge
it. What he gets is his idea on top of current `master`, with nothing stale
carried along.

**3. Push, and the branch gets its own URL.** `check.yml` runs
`pnpm branch:preview` on every push to a non-master branch and writes the link
into the Actions summary:

```
design-onboarding-cards-sefer-web-dev.<account>.workers.dev
```

It is a **CloudflarePreview** — a Worker _version_, uploaded and not deployed —
built `--mode dev`, so it carries `/design`, the comment panel and
`?fixture=1`. It does not touch `sefer-dev.bttdev.org`, it needs no review and
no merge, and the alias is stable: pushing again updates what that same link
serves.

That link is the answer to "can somebody look at this". Nothing here ever
requires pushing to `master` to show somebody something.

Run it by hand with `pnpm branch:preview` (add `--dry` to build and print
without uploading).

**4. Graduate it**, which is the step below and the only one that reaches the
real screens.

## The four steps, once he is on a branch

1. **Try it.** A committed screen in `src/dev/design/screens/`; a throwaway in
   `src/dev/design/local/`, which is gitignored and never appears in a diff.
   Or register tweaks on the real screen in place.
2. **Share it.** The branch preview URL for a person; the localhost URL for
   yourself. Either carries the screen, the variant and every tweak, so
   "compare a against b" is two links.
3. **Say what is wrong.** Comment mode, then paste — or let the agent drain it.
4. **Graduate it.** A variant that wins **moves into the real screen**, and the
   prototype is deleted in the same commit.

### Reviewing the designer's work

- **He owns** feel, polish, motion, hierarchy, density, spacing, and colour
  within the semantic tokens. Those are his calls; do not relitigate them in
  review.
- **Review is for** fit with the architecture, the developer idiom, the
  boundaries, naming, and the single Solid/Book subscription rule.
- **Two bars, two folders.** `src/dev/**` answers a question. It should still
  be good, and it is written by somebody who does not think like a developer;
  it is not held to the shipping bar. `src/app/ui/**` is.
- A diff touching only `src/dev/**` is nearly review-free by construction — the
  boundary checks already prove it cannot reach the application.

## Commands

| Command                     | What it does                                                                              |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| `pnpm dev`                  | Dev server on :3000; `/design` and the panel are on                                       |
| `pnpm branch:preview`       | **A shareable URL for this branch.** Uploads a Worker version; deploys nothing            |
| `pnpm build:dev`            | The `dev`-channel build — the one carrying the design surface                             |
| `pnpm deploy:web dev --dry` | Build and print what would ship, without shipping                                         |
| `pnpm verify:design`        | Proves the surface is in the design build and out of production                           |
| `pnpm boundaries`           | The three path rules                                                                      |
| `pnpm design:scaffolding`   | Lists scaffolding still in application code (exits 0)                                     |
| `pnpm lint:release`         | Makes that scaffolding an error                                                           |
| `pnpm verify:chrome`        | Attaches to the machine's own Chrome over CDP, for driving the app and reading the handle |

His gate before pushing is `pnpm typecheck && pnpm lint && pnpm format:check` —
not `pnpm check`, which also builds. The `pre-commit` hook runs those three
plus `boundaries` and the unit tests anyway, so a commit can fail on something
he was not asked to check; `documentation/agents/designer-setup.md` explains
both to him, and it is the right place to send him for anything about his
machine rather than about the design.

## The debug handle

`globalThis.__sefer.design`, beside the observability handle:

| Call                     | Gives                                                   |
| ------------------------ | ------------------------------------------------------- |
| `declarations()`         | The knobs that exist — the one thing a URL cannot carry |
| `values()`               | What is set, i.e. the URL                               |
| `set(key, value)`        | Turn one                                                |
| `comments()` / `drain()` | The batch; `drain` reads and clears                     |
| `mode()` / `setMode()`   | The pointer                                             |
| `register(...)`          | Scaffolding, above                                      |
