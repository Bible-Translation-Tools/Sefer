---
name: merging-designer-code
description: How to take the UI designer's branch or pull request and land it on master — bring master into his branch, resolve conflicts without losing either side, review it against the developer bar he does not yet ask for himself, get it green, and hand him back a clean master to branch from. Use when merging, rebasing, reviewing or "getting green" a designer PR (e.g. sidebar-update), or when asked whether his code is ready.
---

# Merging the designer's code

The designer is a UX/UI designer, not a developer. An LLM lowers his barrier to
writing code and speeds up review, but it does not ask the questions a
developer would: is this consistent, is it DRY, did the checks pass, is it
instrumented, will it be fast with 30,000 rows. **This skill is those
questions, asked for him.** His Claude writes the code; the merging agent is
the developer who reads it.

Read [the design surface](../design-surface/SKILL.md) first for who owns what.
The short version holds here too: **feel, polish, motion, hierarchy, density,
spacing and colour within the semantic tokens are his calls.** Do not
relitigate taste. Everything below is structure, and structure is ours.

## The mechanics

He does not use git. Assume you are the git.

1. **GitHub's "no conflicts" is against `origin/master`, not your master.** If
   local master is ahead, check the real answer first:
   `git fetch origin && git rev-list --left-right --count origin/master...master`
   and `git merge-tree --write-tree --name-only master origin/<branch>`.
2. **Merge master INTO his branch; never rebase it.** A rebase rewrites the
   history his Claude is sitting on. A merge commit on his branch is harmless,
   because the PR is squash-merged at the end anyway.
   `git switch <branch> && git merge master`
3. **Resolve toward both intents.** The dangerous conflict is modify/delete:
   he deleted or replaced a file that master has since changed. Master's
   change must be CARRIED into his replacement, not dropped with the file.
   Read `git log master -- <deleted file>` since the merge base and port each
   change by hand. Show that resolution to Will before committing it.
   `documentation/lint-results.md` is generated — take either side and run
   `pnpm lint:results`.
4. **`pnpm check` on the merged result**, plus `pnpm deadcode` and
   `pnpm test:browser` (master's `verify` gate runs all three; his branch only
   ran deadcode as advisory — see `check.yml`). A branch that is green on its
   own and red once merged is not green.
5. **Review** (below). Small structural fixes go on HIS branch as their own
   commits, so his Claude sees exactly what changed and why.
6. **Push master first, then his branch** (push needs Will's biometric), so the
   PR is judged against the real trunk. **Squash-merge** the PR: one trunk,
   linear history.
7. **Hand back.** Tell him (or his Claude) to switch to master, pull, and
   branch again. Name the fixes made on his behalf so the next branch does not
   reintroduce them.

## The review: questions he is not asking

Report findings as a conversation, most important first. For each, say how
bad it is and whether fixing it now is proportionate. Not every finding
blocks the merge; a finding that does should say why.

**Do all the checks pass?** On the merged tree, not his branch. Any new
`oxlint-disable`, `@ts-expect-error`, `as any`, or `!` non-null assertion gets
the process in [lint results](../../../documentation/lint-results.md), not a
shrug.

**Is it consistent?** Same naming, file placement and idiom as the
surrounding code. A new screen reads like the screens beside it. New
components live where [the UI layer](../../../documentation/architecture/ui.md)
says they do.

**Is it DRY, or duplicative?** Look for the same markup, the same fetch, the
same formatter or the same state written twice — across his files and against
what already exists. A second date formatter, a second region list, a second
download tracker is the common shape.

**Does it reuse the foundations?** `src/app/ui/primitives/` exists so screens
do not rebuild Button, Dialog, Popover, Select, Table, Tooltip, VirtualList.
A hand-rolled `<div role="button">`, a custom popover, or a raw
`@corvu/*` import outside `primitives/` is a finding. If a primitive is
genuinely missing something, the fix is to grow the primitive, not to fork
it in a screen.

**Is the code tortured?** Signals doing a store's job, effects writing
signals, DOM measurement where CSS would do, deep prop drilling past
`useComposition()`/`useShell()`, 700-line components that are three
components. Read [Solid](../../../documentation/architecture/solid.md) and the
[shell](../../../documentation/architecture/shell.md)'s single Solid/Book
subscription rule; Solid 2 RC, not React — React habits (`useEffect`-shaped
code, destructured props) are the usual source.

**Is it instrumented?** User actions and anything that can fail go through our
observability (spans, `failed` events), not `console.log`, and failures reach
the person as a toast that says why (`src/app/describe.ts`). See
[observability](../../../documentation/architecture/observability.md). A new
download, import or network call with no span is a finding.

**Is it performant?** A list that can be long (books, languages, projects,
findings, catalogue rows — the Language API has hundreds) uses `VirtualList`,
not `.map` into the DOM. No per-row store proxies over big arrays, no work per
keystroke that scales with the project. When in doubt, measure
(`pnpm verify:perf`, or the Solid recompute bridge) rather than guess.

**Is it accessible, like a component library would be?** Keyboard reachable,
visible focus, `Esc` closes, focus is trapped in dialogs and returned on close,
menus and popovers have the right roles and arrow keys, icon-only buttons have
labels, nothing is conveyed by colour alone, dark mode per the ui doc. The
primitives already do most of this — which is the strongest reason to reuse
them.

**Do the units make sense?** He thinks in pixels, and sometimes that is right.
The rule:
ask "should this grow when the person raises their browser's default font
size?" **Yes → rem**: font sizes, and spacing or widths that hold text
(padding around a label, a column that must fit a language name, media-query
breakpoints). **No → px**: borders, hairlines, shadows, icon strokes, small
decorative gaps. A `font-size` in px is always a finding; a 1px border in rem
is a smell. Prefer the Tailwind scale and our tokens over arbitrary
`[13px]` values — an arbitrary value is a design decision the token set does
not know about. This is accessibility, not taste: the numbers stay his, the
unit is ours.

**Is he baking in TODOs, env vars, or hostnames?** New `import.meta.env`
reads outside `src/app/env.ts`, hardcoded URLs, sample data that can leak
into a real build, `TODO` with no date or owner, feature flags that are really
leftover experiments. See [configuration](../../../documentation/architecture/configuration.md).
Design scaffolding (`globalThis.__sefer.design.register`) is fine on a branch
and flagged by `pnpm design:scaffolding`; it must not ship to preview.

**Did the boundaries hold?** `pnpm boundaries` is authoritative: nothing in
`src/core` names Solid, the DOM, or a host; nothing outside `src/dev`
imports `src/dev`. Business logic that crept into a component belongs in
`src/core` or `src/app`, behind the composition.

**Is the documentation still true?** A screen he replaced may be described in
`documentation/architecture/*.md` or `documentation/services.md`. Update the
doc in the same change, or name it as a follow-up.

## What not to do

- Do not restyle. If a colour, spacing or motion looks wrong, say so as a
  question for him; do not change it.
- Do not rewrite his component into yours. Fix the structural finding in the
  smallest diff that fixes it, so his next session recognises his own code.
- Do not add tests to get green; the build-out rule (no new tests until
  behaviour is locked) applies to his branch too.
- Do not close his PR and redo it on master. The PR is the record of his work.
