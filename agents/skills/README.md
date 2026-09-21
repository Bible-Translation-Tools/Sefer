# Skills

Agent skills for this repository. `.claude/skills` is a symlink to this
directory, the same way `CLAUDE.MD` is a symlink to `AGENTS.md` — the content
lives under a tool-neutral name and the tool-specific path points at it.

A skill here is loaded on demand, so it can be longer and more specific than
`AGENTS.md`, which is read every session and has to stay short.

## What belongs here

Two kinds, and they are worth keeping apart.

**How this repository works.** Mechanics and workflow: which commands, which
gates, which folder, who hands what to whom. `design-surface/` is one — the
prototyping route, the comment collector, variants and tweaks, and the
designer-to-developer handoff.

**Design judgement.** Voice, brand, typography, motion, what "quiet" means
here and what it does not. That is not written yet and it is a different
document with a different author: the first kind can be derived from the code
and checked against it, the second cannot.

Mixing them produces a file nobody trusts, because a reader cannot tell which
sentences are load-bearing facts about the build and which are taste that a
reasonable person could argue with.

## Depth lives elsewhere

A skill is the operating guide. The full account of a subsystem stays in
`documentation/architecture/`, and the skill links to it rather than restating
it — two copies of a mechanism is how the second one goes stale.
