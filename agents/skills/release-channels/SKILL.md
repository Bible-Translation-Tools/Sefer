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
| **Trigger** | every push to `master` | dispatch, or a `-rc` tag | a `v*` tag |
| **Vite mode** | `dev` | `production` | `production` |
| **Script** | `pnpm build:dev` | `pnpm build` | `pnpm build` |
| **`/design`, comment panel, `?fixture=1`** | **yes** | no | no |
| **`data-loc` source stamps** | **yes** | no | no |
| **Full test suite** | no | **yes** | **yes** |
| **Desktop matrix** | no | **yes** | **yes** |
| **Release lint** (no leftover scaffolding) | no | **yes** | **yes** |
| **Web host** | `sefer-dev` | `sefer-preview` | `sefer` |
| **Desktop channel** | — | Sefer Preview | Sefer |
| **Roughly** | ~1 minute | ~20 minutes | ~20 minutes |

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
git tag v0.3.0-rc.1 && git push origin v0.3.0-rc.1
```

By hand, web only:

```sh
pnpm deploy:web preview
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
* `v0.3.0-rc.1` — preview. The workflow matches `v*-rc*` **before** `v*`, so
  an rc never lands on production by accident.
* Nothing else is a release tag. `dev` is not tagged; it is wherever master is.

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

## What is not armed yet

`.github/workflows/release.yml` is `workflow_dispatch` only. The `push:`
trigger is commented out because the hostnames in `wrangler.jsonc` are
placeholders and 1Password has no Sefer item. Arming it is uncommenting one
block — `resolve` already handles all three cases.

Still missing, in order:

1. Hostnames registered, `op://DevOps/Sefer` created with
   `cloudflare-api-token` and `cloudflare-account-id`
2. The desktop build job (commented stub at the foot of the workflow)
3. The updater worker — `planning/02-ready/updater-worker.md`

Until then a "deploy" means `pnpm deploy:web <channel> --dry`, which builds
and prints the wrangler command without shipping.
