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
nobody runs `wrangler secret put` by hand. Keep that.

`Bible-Translation-Tools/Sefer` is **public**, so this token is not about
access — the releases API is readable without one. It is about **rate
limits**: unauthenticated GitHub allows 60 requests an hour per IP, and a
Cloudflare Worker shares egress IPs with everyone else on the edge, so an
updater with no token will start returning nothing under load for reasons
nobody can reproduce locally. Authenticated is 5,000/hour.

Fine-grained token, `Contents: Read`, scoped to this repository only. Set an
expiry and a calendar reminder; the pipeline rotating the Worker secret on
every deploy means renewing is a 1Password edit and a redeploy, not a hunt.

## Secrets to create before this starts

Two things a human has to do once. Neither needs the worker to exist yet, and
doing them now unblocks the rest.

### The updater signing keypair

```sh
pnpm exec tauri signer generate -w ~/.sefer-updater.key
```

It prompts for a password — set one, do not leave it empty. That writes
`~/.sefer-updater.key` (private) and `~/.sefer-updater.key.pub` (public).

Then:

| Where it goes | What |
| --- | --- |
| `src-tauri/tauri.conf.json`, `plugins.updater.pubkey` | the `.pub` contents — **committed**, it is public |
| `op://DevOps/Sefer/tauri-updater-private-key` | the contents of `~/.sefer-updater.key` |
| `op://DevOps/Sefer/tauri-updater-private-key-password` | the password |

The config today holds the literal `REPLACE_WITH_MINISIGN_PUBLIC_KEY`, so it
is obvious when this is still undone. In CI these become
`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

**Generate a new one; do not copy Zephyr's.** This keypair is the trust root
for auto-updates — reuse means a Zephyr-signed manifest validates for Sefer
clients and the reverse. `documentation/architecture/desktop.md` already states
the policy: the v1 app's key is deliberately not reused either.

Keep the private key somewhere real as well as in 1Password. Losing it means
existing installs can never be updated again — you would have to ship a new
signed app and ask people to reinstall.

#### One key, and `tauri.conf.preview.json` does not hold it

The preview config is an OVERLAY. `tools/tauri/run.ts` passes it as a second
`--config` on top of `src-tauri/tauri.conf.json`, so it carries only what
differs between channels — product name, identifier, window title. The pubkey
lives in the base config and both channels inherit it. Do not copy it in;
duplicating it is how the two would eventually disagree.

Nor do the channels want separate keypairs. They are kept apart by
**identifier and endpoint**, not by signature: `org.wycliffe.sefer` and
`org.wycliffe.sefer.preview` install side by side and each asks its own
updater URL. A second key would isolate a compromise in theory, but both
private halves would live in the same 1Password item and pass through the same
CI, so the blast radius is identical in practice and the operational cost is
not. One key per app is also what the old repo does — a single
`zephyr-updater.key` for both its channels.

So the three moving parts sit in three places, each for its own reason:

| What | Where | Why |
| --- | --- | --- |
| Public key | `tauri.conf.json`, committed | Same for every channel; it is public |
| Identity | `tauri.conf.preview.json` overlay | The only thing a channel changes |
| Endpoint | `SEFER_UPDATER_HOST` in the environment | Differs per channel, and `documentation/architecture/desktop.md` is explicit that endpoints never live in the repository |

### The updater GitHub token

Fine-grained PAT, `Contents: Read`, this repository only →
`op://DevOps/Sefer/updater-gh-token`. See the rate-limit note above for why a
public repo still wants one.

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
