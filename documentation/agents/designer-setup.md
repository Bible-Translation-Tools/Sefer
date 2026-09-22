# Getting set up to design in Sefer

For a designer joining this repository. You do not need to know Solid, or JS
beyond reading it. You do need the app running locally and Claude Code pointed
at it.

Follow this once. It takes about twenty minutes, most of it waiting on
installs.

## 1. Tools

```sh
# Node 24.4.1 — if you have none, install via https://github.com/Schniz/fnm
fnm install 24.4.1 && fnm use 24.4.1

# pnpm, which is the package manager this repo uses. Not npm, not yarn.
corepack enable && corepack prepare pnpm@latest --activate

# Claude Code
npm install -g @anthropic-ai/claude-code
```

You do **not** need Rust. That is only for the desktop build, and everything
below is the web one.

## 2. The repository

```sh
git clone <repo-url> Sefer
cd Sefer
pnpm install
pnpm dev
```

Open <http://localhost:3000>. If the port is busy, `pnpm dev --port 3210`.

## 3. Your two routes

**`/design`** — the prototyping surface. Screens, variants, tweaks. Nothing
here ships; it is where an idea gets tried.

**Everywhere else** — the real application. You can comment on any of it.

For the screens that need scripture — the editor, review, the inventory — add
`?fixture=1` to any URL. That opens four real books (Psalms, Philemon, 3 John,
Jude) without importing anything. Use it: judging line length and density on
placeholder text produces layouts that break on real book names and on Greek
and Hebrew, which is most of what this application shows.

## 4. The floating panel

Bottom right of every page. It minimises to a small puck; click it to open.

**Interact** is normal. **Comment** turns the pointer into a crosshair, and
while it is on the application is frozen — clicking selects an element instead
of pressing it. That is deliberate. `Esc` always gets you out. On `/design`,
`c` toggles it.

To report something: Comment → click the thing → type → **Enter**. That copies
the whole batch to your clipboard. Paste it into Claude. If you have several
things to say, use **Add to batch** for each and Copy once at the end.

**One comment about several things.** Hold **Shift** while clicking to gather
elements instead of commenting on each. Click the last one without Shift and
you get one box for all of them. Each gets a numbered pin on the screen, and
the same numbers appear in what you paste — so "1 should go where 2 is" means
something to whoever reads it.

**Changing the hotkey.** The `⋯` menu has `hotkey: …`. Click it and press the
keys you want — `⌥C` is a good one, because it works even where a plain letter
would collide with the editor. `⌫` while recording turns it off.

What you paste looks like this, and the file:line is why it is worth doing
this way rather than describing the element in prose:

```
## http://localhost:3000/design?primitives.size=sm

[1] src/app/ui/primitives/Button.tsx:77:5  "tertiary"
    too faint against the card.

[2] src/app/ui/primitives/Button.tsx:77:5  "primary"
[3] src/app/ui/primitives/Button.tsx:77:5  "secondary"
    these two should swap.

## http://localhost:3000/terms

[4] src/app/ui/excerpts/StetView.tsx:31:7  "Key terms"
    this heading should match the rail.
```

**You can keep going across pages.** The panel stays with you as you navigate,
so a single batch can be a walk — a few notes here, then move to key terms and
a few more. Each page prints its own address, so one paste tells the whole
story in order.

**Brief / Full**, next to the Copy button, only changes what gets *written* —
everything is always recorded. **Full** adds the window size and light/dark,
which matters when whoever reads it can't open the app themselves.

On `/design`, the panel also holds **variants** (whole alternative takes on a
page) and **tweaks** (single knobs). Everything they set goes into the URL —
so a link is the state. Copy it and send it; the person opening it sees what
you saw.

## 5. Claude Code

From the repository root:

```sh
claude
```

Then, once, so it knows the rules of this repository:

```
Read agents/skills/design-surface/SKILL.md and follow it for design work here.
```

That file explains the prototyping route, the comment collector, variants and
tweaks, and how a change graduates into the real screens.

### Asking for things

Paste a comment batch and say what you want. Useful shapes:

* *"Here are four comments from /design. Fix 1 and 3, tell me why 2 is harder
  than it looks, leave 4."*
* *"Make a variant of this screen with the actions in a right rail instead of
  under the header. Keep the current one."*
* *"Add a tweak for row density on this screen so I can compare three values."*

Two things to tell it when you want them:

* **Screenshots.** `pnpm verify:chrome` starts a headless Chrome that Claude
  can drive and screenshot, so it can check its own work instead of asking you
  to look. Say "start the verification browser and show me" if it does not.
* **Real text.** Ask for `?fixture=1` if it hands you an empty screen.

## 6. Committing

Work on a branch, never on `master`:

```sh
git checkout -b design/onboarding-cards
```

Claude can do the git for you — "commit this and open a PR" works. Before you
push, run:

```sh
pnpm typecheck && pnpm lint && pnpm format:check
```

That is your gate. **Do not** run `pnpm check` — it also builds and runs the
test suite, which is slower and is not yours to worry about.

### One kind of change per commit

You will make two quite different kinds of change, and they want separate
commits:

* **A fix to a real screen** — the spacing was wrong, the weight was wrong.
  This touches `src/app/ui/`.
* **A prototype** — a new screen at `/design`, an idea with variants. This
  touches `src/dev/`.

Keep them apart. Not bureaucracy: the two get reviewed completely differently,
and a commit holding both has to be read at both standards at once, which
usually means one half gets no real attention. "Commit the prototype
separately from the fix" is a thing you can just say to Claude.

### When an idea wins, delete it

The prototype is scaffolding. Once a variant has won, it moves into the real
screen **and the prototype file is deleted in the same commit** — one file in
`src/dev/design/screens/`, gone. Nothing else points at it, so there is nothing
else to tidy.

Two things that make this painless, and are worth knowing before you start:

* **Put the winning link in the commit message.** The URL carries the screen,
  the variant and every tweak, so whoever reviews it can open exactly what you
  chose instead of guessing from the diff.
* **The real screen should end up with no knobs.** If graduating means leaving
  a switch in the real component so it can still render both ways, the idea
  has not actually won yet. The product renders one thing.

## What is yours, and what is not

**Yours:** how it feels. Polish, motion, hierarchy, density, spacing, and
colour — within the semantic tokens (`src/app/ui/tokens.css`). If a colour you
want is not a token, ask for one rather than writing a hex code; that is what
keeps dark mode working without you thinking about it.

**Not yours to worry about:** the architecture, the boundaries, the tests. If
you touch something you should not, `pnpm boundaries` fails and says so. It is
a guardrail, not a scolding — it exists so you can move quickly without
learning the rules first.

**Two different standards, and this matters.** Anything under `src/dev/` is
answering a question. It is allowed to be rough, and it will not be reviewed
as if it were shipping. Anything under `src/app/ui/` is the real product and
gets a real review. Claude knows the difference; if you are not sure which you
are in, ask it.

**The point is graduation.** A prototype that stays a prototype has not
changed anything. When a variant wins, it moves into the real screen — that is
a normal pull request, and it is the moment the work counts.
