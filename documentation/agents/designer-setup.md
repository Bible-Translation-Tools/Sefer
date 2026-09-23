# Getting set up to design in Sefer

For a designer joining this repository. You do not need to know Solid, or JS
beyond reading it. You do need the app running locally and Claude Code pointed
at it.

Follow this once. It takes about twenty minutes, most of it waiting on
installs.

## 1. Tools

Four things, and that is the whole list. This is a suggestion for tools, but you maybe already have some installed. Check first.

```sh
# 1. Node 24.4.1. If you have no Node at all, fnm is the smallest way in:
#    https://github.com/Schniz/fnm
fnm install 24.4.1 && fnm use 24.4.1

# 2. pnpm — the package manager this repo uses. Not npm, not yarn.
npm install -g pnpm@12.0.0-rc.11

# 3. Claude Code
npm install -g @anthropic-ai/claude-code

# 4. the GitHub CLI, so Claude can open pull requests for you
brew install gh && gh auth login     # or https://cli.github.com
```

**pnpm is installed directly rather than through corepack.** Corepack reads
the version out of `package.json` and installs it on the fly, which sounds
tidier and has been moving around between Node releases; a direct global
install is one thing that either works or doesn't. The version above matches
`packageManager` in `package.json` — if you ever see a version-mismatch
warning, that is the line to re-run.

Two things you specifically do **not** need:

- **Rust.** That is only for the desktop build. Everything here is the web one.
- **Playwright browsers.** They are a separate ~300MB download for the test
  suites, which are not yours to run. `pnpm install` does not fetch them, and
  nothing in your day asks for them.

One you probably already have: **Google Chrome**, the ordinary app. Claude
drives _that_ to look at its own work (§5), which is exactly why the Playwright
download is unnecessary — it attaches to the Chrome you already run rather than
downloading a second browser to launch.

You also need **write access to the repository** — ask for it before you start
rather than discovering it on your first push.

## 2. The repository

```sh
git clone https://github.com/Bible-Translation-Tools/Sefer.git
cd Sefer
pnpm install
pnpm dev
```

Open <http://localhost:3000>. If the port is busy, `pnpm dev --port 3210`.

`pnpm install` also installs git hooks. That is why your first commit pauses
for a few seconds — see §6.

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

## http://localhost:3000/project/small-nt/terms

[4] src/app/ui/excerpts/StetView.tsx:31:7  "Key terms"
    this heading should match the rail.
```

**You can keep going across pages.** The panel stays with you as you navigate,
so a single batch can be a walk — a few notes here, then move to key terms and
a few more. Each page prints its own address, so one paste tells the whole
story in order.

**Brief / Full**, next to the Copy button, only changes what gets _written_ —
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

- _"Here are four comments from /design. Fix 1 and 3, tell me why 2 is harder
  than it looks, leave 4."_
- _"Make a variant of this screen with the actions in a right rail instead of
  under the header. Keep the current one."_
- _"Add a tweak for row density on this screen so I can compare three values."_

Two things to tell it when you want them:

- **Screenshots.** `pnpm verify:chrome` starts a headless Chrome that Claude
  can drive and screenshot, so it can check its own work instead of asking you
  to look. Say "start the verification browser and show me" if it does not.
  It attaches to the Chrome already on your machine, so if Claude ever reports
  a missing browser executable, tell it to connect to `pnpm verify:chrome`
  over CDP rather than launching one — the downloaded browsers are for the
  test suites and are deliberately not installed here.
- **Real text.** Ask for `?fixture=1` if it hands you an empty screen.

## 6. Committing

Work on a branch, never on `master`:

```sh
git checkout -b design/onboarding-cards
```

Claude can do the git for you — "commit this and open a PR" works.

### Always branch from a fresh `master`

```sh
git checkout master && git pull
git checkout -b design/onboarding-cards
```

Start every piece of work this way, even when the last one is barely cold.
Branching from `master` each time means your changes sit on top of everything
that has happened since — and since somebody else may be committing a dozen
times a day, "since" is a lot. A branch that has been alive for two weeks is
the one that hurts to merge.

**You should never be the person resolving a merge.** If a branch has fallen
behind far enough to conflict, say so rather than fighting it — the fix is
almost always to start a fresh branch from `master` and bring the change over,
which takes minutes.

### Your old work is a reference, not something to merge

Keep a long-lived branch of your own if you like — `th`, or `design` — as a
place your ideas live. Treat it as a **sketchbook**: something to look at and
copy from, never something to merge.

So the move is: fresh branch from `master`, then tell Claude _"reuse the card
layout from my `th` branch"_. It reads the old work and rewrites it against
today's code. What you get is your idea on top of current `master`, with no
merge and nothing stale carried along.

### Somebody can look at your branch without you merging anything

Push the branch and CI builds it to its own URL — something like
`design-onboarding-cards-sefer-web-dev.…workers.dev` — which appears in the
Actions summary for that push. It carries `/design`, the comment panel and
`?fixture=1`, exactly like the shared dev site.

That link is safe to send to anyone. It does not touch `sefer-dev.bttdev.org`,
and it does not require your work to be merged, reviewed, or finished. It is
there so you never have to push to `master` just to show somebody something.

Before you push, run:

```sh
pnpm typecheck && pnpm lint && pnpm format:check
```

That is your gate. **Do not** run `pnpm check` — it also builds, which is
slower and is not yours to worry about.

### Your commit runs its own checks, and may fail on one

Committing triggers a git hook that runs five things in parallel — the three
above, plus `boundaries` and the unit tests. It takes a few seconds, and it is
why a commit is not instant.

Two of those five are not in your gate, so a commit can fail on something you
were not asked to check:

- **`boundaries`** fails if a file reached somewhere it is not allowed to. It
  is a guardrail, not a scolding, and its message says exactly what reached
  what. Usually the fix is a one-line import change — tell Claude what it
  said.
- **the unit tests** fail if something the code promises stopped being true.
  If this happens on a change that is purely visual, it is worth saying so out
  loud rather than making the test pass: a styling change breaking a test
  usually means the test was testing the wrong thing, and that is somebody
  else's to fix.

Neither is a reason to stop. `git commit --no-verify` skips the hook if you
need to save work in a hurry, and CI will still tell the truth later.

### One kind of change per commit

You will make two quite different kinds of change, and they want separate
commits:

- **A fix to a real screen** — the spacing was wrong, the weight was wrong.
  This touches `src/app/ui/`.
- **A prototype** — a new screen at `/design`, an idea with variants. This
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

- **Put the winning link in the commit message.** The URL carries the screen,
  the variant and every tweak, so whoever reviews it can open exactly what you
  chose instead of guessing from the diff.
- **The real screen should end up with no knobs.** If graduating means leaving
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
