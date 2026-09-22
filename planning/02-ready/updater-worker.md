# Handoff: the Sefer updater worker

**For a fresh agent.** Self-contained: everything you need to start is below.
Paste the prompt at the bottom, or read the whole thing first.

## What this is

Sefer's desktop app ships with the Tauri updater plugin. The plugin asks a URL
whether a newer build exists; that URL is a tiny Cloudflare Worker that reads
GitHub releases and answers with a signed manifest. Sefer does not have one
yet. `scripture-editor-proto-2` does, and it is close to copy-paste.

## Where the original lives

```
../scripture-editor-proto-2/workers/zephyr-updater/
```

Read `wrangler.toml` and the worker source before changing anything. Its
`release.yml` also carries a comment about a real bug worth inheriting: wrangler
invoked via pnpm from a subdirectory fell back to the REPOSITORY ROOT
`wrangler.jsonc` and redeployed the SPA a second time instead of the updater.
Pass `--config workers/sefer-updater/wrangler.toml` explicitly, always.

## What to change, and what not to

**Rename** every `zephyr` to `sefer` — worker name, hostnames, the 1Password
paths (`op://DevOps/Sefer/...`).

**Channels.** The original is stable/nightly. Sefer is **stable/preview** —
see `documentation/architecture/desktop.md`. `tools/tauri/updaterConfig.ts`
already has `Channel = "stable" | "preview"` and `SEFER_CHANNEL=preview`
selects `src-tauri/tauri.conf.preview.json`. The worker must answer both, and
must not serve a preview build to a stable client.

**Do NOT reuse the signing keypair.** This is the one thing that must be new.
The updater keypair is the trust root for auto-updates: reuse Zephyr's and a
Zephyr-signed manifest would validate for Sefer clients and vice versa —
cross-app update injection. Generate a fresh one:

```sh
pnpm tauri signer generate -w ~/.sefer-updater.key
```

Public half goes in `src-tauri/tauri.conf.json` at `plugins.updater.pubkey`,
which today holds the literal placeholder `REPLACE_WITH_MINISIGN_PUBLIC_KEY`.
Private half and its password become the `TAURI_SIGNING_PRIVATE_KEY` /
`_PASSWORD` secrets. `documentation/architecture/desktop.md` already states
this policy — it says the v1 app's key is deliberately not reused — so you are
following an existing decision, not making one.

**`GH_TOKEN`.** The original refreshes it as a Worker secret on every deploy,
sourced from 1Password, so the pipeline is the single rotation point and
nobody runs `wrangler secret put` by hand. Keep that. It needs `public_repo`
only.

## Where it goes

```
workers/sefer-updater/
  wrangler.toml
  src/...
```

`.github/workflows/release.yml` in this repo has a commented `build-desktop`
job and a `deploy-web` job. The updater deploy is a **separate step** from the
SPA deploy — see the warning above about `--config`.

## Done when

- [ ] `workers/sefer-updater/` exists and `pnpm exec wrangler deploy --config workers/sefer-updater/wrangler.toml --env preview --dry-run` succeeds
- [ ] A fresh keypair is generated and `tauri.conf.json` no longer says `REPLACE_WITH_MINISIGN_PUBLIC_KEY`
- [ ] Channels are stable/preview, not stable/nightly
- [ ] `documentation/architecture/desktop.md` updated where it describes the updater endpoint
- [ ] Hostnames left as clearly-marked TODO placeholders if DNS is not registered yet

## Prompt

> Port the Zephyr updater worker from `../scripture-editor-proto-2/workers/zephyr-updater/`
> into this repository at `workers/sefer-updater/`. Read
> `planning/02-ready/updater-worker.md` first and follow it — particularly the
> parts about generating a NEW signing keypair rather than reusing Zephyr's,
> the stable/preview channel names, and passing `--config` explicitly to
> wrangler. Leave hostnames as TODO placeholders. Do not arm any workflow
> trigger.
