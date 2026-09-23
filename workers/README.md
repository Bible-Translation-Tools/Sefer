# workers/

Things this repository **deploys** that are not the application: the Tauri
updater today, and whatever support services follow — a comment store on D1,
say.

Each is its own pnpm workspace package with its own `wrangler.toml`, its own
hostnames and its own deploy step. One `pnpm install` at the root covers them
all, which is what lets wrangler resolve a worker's dependencies when it is
deployed from the root with `--config`.

| Worker | What | Deploy |
| --- | --- | --- |
| `sefer-updater` | Serves the Tauri auto-updater manifest from GitHub Releases | `pnpm deploy:updater <preview\|production>` |

## The rule that is easy to get wrong

**Always pass `--config workers/<name>/wrangler.toml`.**

Wrangler invoked from the repository root without it falls back to the ROOT
`wrangler.jsonc` — the SPA — and redeploys that instead of the worker you
meant. It succeeds, so nothing tells you. The old repo hit this and left a
comment about it; `tools/deploy/updater.ts` passes the flag on every
invocation so nobody has to remember.

## What does not go here

The browser git proxy. It is `../wacs-isomorphic-git-proxy`, it is shared by
every WACS browser client, and it is not Sefer's to own — see
`documentation/architecture/configuration.md`. The test is whether another application
would want the same instance: if yes, it is a shared service and lives on its
own; if no, it belongs here.
