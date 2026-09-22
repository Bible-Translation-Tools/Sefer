---
name: release-channels
description: Sefer's three channels (dev, preview, production), what each one builds and deploys, the tag format, and the exact commands to run. Use when asked to deploy, ship, promote, cut a release, tag a version, publish to preview or production, or when deciding what a push to master will do.
---

# Channels, tags, and what to actually run

Somebody says "push this to preview" or "tag it for prod". This is the file
that turns that sentence into commands.

Full rationale: `documentation/architecture/design.md` for the build switch,
`documentation/architecture/desktop.md` for the desktop side.

## The matrix

| | `dev` | `preview` | `production` |
| --- | --- | --- | --- |
| **Trigger** | every push to `master` | dispatch, or a `v*-*` candidate tag | a `v*` final tag |
| **Vite mode** | `dev` | `production` | `production` |
| **Script** | `pnpm build:dev` | `pnpm build` | `pnpm build` |
| **`/design`, comment panel, `?fixture=1`** | **yes** | no | no |
| **`data-loc` source stamps** | **yes** | no | no |
| **Full test suite** | no | **yes** | **yes** |
| **Desktop matrix** | no | **yes** | **yes** |
| **GitHub release** | no | prerelease | release |
| **Release lint** (no leftover scaffolding) | no | **yes** | **yes** |
| **Web host** | `sefer-dev` | `sefer-preview` | `sefer` |
| **Desktop channel** | — | Sefer Preview | Sefer |
| **Roughly** | ~1 minute | ~20 minutes | ~20 minutes |

## "Preview" means two unrelated things. Always say which

This is the one piece of vocabulary in the repository that is worth being
pedantic about, because getting it wrong means promoting to the wrong place and
the mistake is quiet.

| Say | For |
| --- | --- |
| **ChannelPreview** | the `preview` CHANNEL in the table above — `sefer-preview.bttdev.org`, a promotion, full suite, full desktop matrix |
| **CloudflarePreview** | `wrangler versions upload` — a new VERSION of a Worker that is *not deployed*, on its own hostname |
| **Branch preview** | a CloudflarePreview of one branch, built `--mode dev` |

`documentation/glossary.md` holds the canonical definitions.

## A URL for a branch, without deploying anything

    pnpm branch:preview                  # alias from the current branch
    pnpm branch:preview design/cards     # or name it
    pnpm branch:preview --dry            # build, print the command, ship nothing

Uploads a VERSION of the `sefer-web-dev` Worker and prints a URL like
`design-cards-sefer-web-dev.<account>.workers.dev`. `check.yml` does this
automatically on every push to a branch that is not `master`, and writes the
URL into the job summary.

**It does not deploy.** `sefer-dev.bttdev.org` keeps serving whatever master
last deployed; a version is uploaded beside it. That is the property that makes
this safe to run on every branch push.

**It builds `--mode dev`** — the same mode as the `dev` channel — so a branch
preview carries `/design`, the comment panel and `?fixture=1`. A preview you
cannot comment on would be missing most of the point.

Why it exists: master was the only thing that deployed a web build, so "let
somebody look at this" meant "push to master" — the busiest branch, and the one
with no pre-merge gate. Now a branch is enough.

The alias is a hostname label, so the branch name is slugified and truncated
(`design/onboarding-cards` → `design-onboarding-cards`). Two long branches
sharing a 28-character prefix would share a URL; that is accepted, because an
alias somebody can read and retype is worth more than collision-proofing, and
the cost is one preview overwriting another rather than anything being lost.

## The commands

### "Deploy to dev"

Nothing to run. Every push to `master` does it. To do it by hand:

```sh
pnpm deploy:web dev            # add --dry to build and print without shipping
```

### "Deploy to preview" / "let people test drive this"

A promotion, deliberately. Either:

```sh
gh workflow run release.yml -f channel=preview
```

or tag it, which is preferred when the thing being tested has a name:

```sh
git tag v0.3.0-1 && git push origin v0.3.0-1
```

By hand:

```sh
pnpm deploy:web preview        # the app
pnpm deploy:updater preview    # the updater worker, if it changed
```

### "Tag it for prod" / "cut a release"

```sh
git tag v0.3.0 && git push origin v0.3.0
```

That is the whole action. The workflow resolves the channel from the tag,
runs the full gate, builds the desktop matrix and deploys the web.

### Before any of it, locally

```sh
pnpm check            # typecheck, lint, format, boundaries, unit, build
pnpm test:browser     # the real Chromium project
pnpm verify:design    # the surface is in dev and out of production
```

## Tag format

* `v0.3.0` — production. Semver, `v` prefix.
* `v0.3.0-1` — preview. The candidate number is a **single numeric**
  pre-release identifier, and that is a constraint rather than a style
  choice: Tauri's MSI bundler accepts only a single-identifier numeric
  pre-release (<= 65535), so `v0.3.0-rc.1` — two identifiers, the first
  non-numeric — fails the Windows build. Inherited from the old repo, which
  hit it.
* Nothing else is a release tag. `dev` is not tagged; it is wherever master is.

Semver orders these the way you want without special cases: `0.3.0-2` beats
`0.3.0-1`, and `0.3.0` beats both — so somebody on a candidate rolls onto the
final when it ships rather than being stranded until the next candidate.

## Why a push to master deploys "dev"

It reads oddly — master is the trunk, and the trunk deploys the least stable
channel. That is deliberate, and the alternative is worse.

The alternative is a long-lived `dev` branch. That means a merge train,
divergence between the branch and the trunk, and somebody reconciling them
every week — and the person most often working here is a designer who does not
use git. The whole design surface exists so he can work on master directly;
reintroducing a branch to hold his work would undo it.

**What we buy instead: linear history.** One trunk, feature branches that are
short and merge fast, tags for the moments that matter. `git log master` is
the actual order things happened, `git bisect` works without thinking, and
"what is on preview" is a tag rather than an argument between two branches.

**And one property worth protecting:** `dev` and `preview` are the same commit
built two ways. So "works on dev, broken on preview" can only ever be the
design surface — never drift. With a branch you lose that immediately.

If the name keeps grating, `edge` is the word that means "tip of trunk"
without implying a branch (Deno, Cloudflare). It is a find-and-replace, not a
redesign.

## Why desktop has two channels and web has three

Because a desktop build costs twenty minutes across three operating systems
and a web build costs one.

Three desktop channels is not unheard of — Zed ships Stable, Preview and
Nightly — but at this team size the third would be a matrix nobody waits for.
So the asymmetry is the point: **web gets the fast channel because it can
afford one.**

That only works while the web build stays near-feature-equivalent with
desktop. If web falls meaningfully behind, `dev` stops representing the
product and the whole arrangement quietly stops being useful. Worth checking
when a desktop-only capability lands.

There is no desktop `dev` channel and we are not planning one.

## Armed, and what that currently means

`push` is live: master deploys `dev`, a `v*` tag releases. Five jobs —
`resolve`, `verify`, `deploy-web`, `deploy-updater`, `build-desktop`.

**The custom-domain routes are commented out**, so every channel deploys to
its own `*.workers.dev` subdomain. That is deliberate rather than unfinished:
it means the pipeline actually runs today instead of failing on a route for a
hostname nobody has registered. When DNS exists, uncomment the channel's
`routes` block in `wrangler.jsonc` (web) or
`workers/sefer-updater/wrangler.toml` (updater). Nothing else changes.

One trap that follows from that: a desktop binary asks the updater URL it was
BUILT with, from `SEFER_UPDATER_HOST`. Move the worker to a custom domain
without moving that variable and you get an updater that silently never finds
anything.

### Live now

The updater workers are deployed:

| Channel | URL |
| --- | --- |
| preview | `https://sefer-updater-preview.wycliffe-associates-account.workers.dev` |
| production | `https://sefer-updater-production.wycliffe-associates-account.workers.dev` |

Both answer `/versions` with `[]` and update checks with 404 — correct until a
release exists. Their `GH_TOKEN` secrets are set.

Every value CI needs is in `op://DevOps/Sefer`, including the two updater
hosts (`updater-host-preview`, `updater-host-production`). Those are not
secrets — a host ships inside every binary — but keeping them beside the rest
means one place to look, and the desktop job already authenticates there.

### Still to do

1. Register the web hostnames and uncomment the `routes` blocks in
   `wrangler.jsonc`. When the UPDATER moves to a custom domain, change
   `updater-host-*` in 1Password in the same sitting — a binary asks the URL
   it was built with, and a mismatch is an updater that silently finds nothing.
2. Cut the first candidate tag and see what the desktop matrix says. It has
   never run.

### A first release, in order

```sh
# 1. a candidate — full gate, full desktop matrix, GitHub prerelease
git tag v0.1.0-1 && git push origin v0.1.0-1

# 2. check the release has .app.tar.gz / .AppImage / -setup.exe AND their .sig
#    siblings. Those assets are what the updater serves; without them it
#    correctly answers 404.

# 3. the real thing
git tag v0.1.0 && git push origin v0.1.0
```

Dry runs need no credentials: `pnpm deploy:web <channel> --dry` and
`pnpm deploy:updater <channel> --dry` build and print without shipping.
