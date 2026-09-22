# Desktop host

`src-tauri/` is the Tauri 2 host. It supplies the six things a browser cannot: real files, native
dialogs, OS paths and locale, native git, an OS keychain, and self-update. Each has one Layer in
`src/platform/tauri/` behind a core port, so nothing above `src/platform` learns Tauri exists —
`pnpm boundaries` enforces that direction.

## Layers and what they sit on

| Port                                   | Layer                               | Backed by                                                                         |
| -------------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------- |
| `effect/FileSystem`                    | `TauriFileSystemLive`               | `@tauri-apps/plugin-fs`; `watch` is a real `Stream`, `rename` replaces atomically |
| `HostInfo`                             | `TauriHostInfoLive(build)`          | `@tauri-apps/api/path` + `plugin-os`; all capabilities true                       |
| `Dialogs`                              | `TauriDialogsLive`                  | `plugin-dialog`; returns real absolute paths, unlike the Web pickers. `pickSaveFile` is desktop-only in practice — Web answers `None` and downloads instead |
| `Credentials`                          | `TauriCredentialsLive`              | `credentials_*` commands over the `keyring` crate, service `org.wycliffe.sefer`   |
| `Git`                                  | `TauriGitLive`                      | `git_*` commands over `git2`                                                      |
| `Remote`                               | `TauriRemoteLive({ giteaHost })`    | `git_ensure_remote/fetch/pull/push`; `publish` needs `Gitea` for repo creation    |
| `Updater` (`src/core/host/updater.ts`) | `TauriUpdaterLive({ updaterHost })` | `plugin-updater` + `install_update_from_endpoint`                                 |

`CorpusEngine` is **not** in that table any more. Desktop ran the whole-corpus half natively —
`corpus_*` commands over a `usfm_galley` Expediter on one owner thread, rayon inside `publish` — and
that door is deleted. The id doors answer off the text a handle retains, so one engine in the
webview is the only shape in which the parse path can name a book instead of re-sending it; see
[Galley](galley.md). Desktop and Web now analyze through the identical Layer.

`src/app/services.ts` picks these by `detectHost()` and loads them through a dynamic
`import("../platform/tauri/index")` inside the `tauri` branch only. That is load-bearing: every file
behind that barrel imports `@tauri-apps/*`, and a static import would put the plugins in the Web
bundle. `pnpm build` currently emits them as their own chunk that a browser never fetches.

## Plugins and capabilities

`fs`, `dialog`, `os`, `opener` on every target; `updater`, `process`, `window-state` on desktop only
(mobile ships through app stores). `src-tauri/capabilities/default.json` enables the fs commands the
FileSystem layer calls (and `dialog:allow-save`, which the export flow needs and which
`dialog:default` already carried — it is named anyway so a reader can see what a command needs
without opening the plugin) and grants their paths ONCE through `fs:scope`, over `$APPDATA`,
`$APPLOCALDATA`, `$DOCUMENT` and `$HOME`. Each base is listed four times — bare, `/**`, `/**/.*` and
`/**/.*/**` — because a glob does not match a leading dot and every project contains a `.git`.
Projects live in the user's own folders on desktop, so the scope is broad; it is still explicit, and a
path outside it comes back as `PermissionDenied` rather than as a silent empty read.

## Rust commands

`credentials_get/set/clear` answer `Credentials`; `install_update_from_endpoint` serves the manual
version switch; `corpus_*` are the native engine ([galley.md](galley.md)). The git2 half is one
command per port member, and the whole `Git` port is answered — no member refuses by name any more:

| Rust command                 | TS member                             | Port     |
| ---------------------------- | ------------------------------------- | -------- |
| `git_open`                   | `Git.open`                            | `Git`    |
| `git_init`                   | `Git.init`                            | `Git`    |
| `git_status`                 | `Git.status`                          | `Git`    |
| `git_commit`                 | `Git.commit`                          | `Git`    |
| `git_log`                    | `Git.log`                             | `Git`    |
| `git_previous_versions`      | `Git.previousVersions`                | `Git`    |
| `git_show`                   | `Git.show`                            | `Git`    |
| `git_log_from`               | `Git.logFrom`                         | `Git`    |
| `git_resolve_ref`            | `Git.resolve`                         | `Git`    |
| `git_current_branch`         | `Git.branch`                          | `Git`    |
| `git_changed_paths_between`  | `Git.changedPathsBetween`             | `Git`    |
| `git_ensure_remote`          | `Remote.attach`                       | `Remote` |
| `git_remote_url`             | `Remote.origin`                       | `Remote` |
| `git_fetch`                  | `Remote.fetch`                        | `Remote` |
| `git_pull`                   | `Remote.pull`                         | `Remote` |
| `git_push`                   | `Remote.push`, and `publish`'s second half | `Remote` |
| `git_move_branch`            | `Remote.moveBranch`                   | `Remote` |
| `git_abort_merge`            | `Remote.abortMerge`                   | `Remote` |

Every command returns `Result<T, String>` where the string is `"<Reason>: <detail>"` — the vocabulary
is in `src-tauri/src/errors.rs` (`NotARepository`, `Io`, `Conflict`, `Refused`, `AuthFailed`,
`Offline`, `Rejected`). The TS adapters read only the prefix, so libgit2's prose can change without
breaking the mapping. `remote_callbacks_for_token` and the transport classifier are ported from the v1
app. `pull` fast-forwards or reports `Conflict`: Sefer never merges USFM behind a translator's back.

### What the Rust side promises

These are the semantics the two hosts must agree on, and where they are enforced:

- **The receipts rule.** `git_commit` stages exactly the paths it was given — no `add_all` — and
  `relative_path` re-checks each one is inside the work tree. The TS adapter has already run core's
  `repositoryPath`; Rust checks again because this process can write anywhere the user can.
- **Nothing to commit is refused.** An empty path list is `Refused` in the Web layer's own words, and
  so is a list whose paths all turn out to be deletions of things never recorded. Without that, an
  unborn HEAD produced an empty root commit — a first version holding no scripture.
- **Committing an unchanged tree is not an error.** It returns the existing HEAD id rather than
  adding an empty version to the timeline a translator reads.
- **`resolve` and `branch` answer `None`, not a failure.** "Nobody has pushed to this yet" and "HEAD
  is detached" are states. An unborn HEAD still NAMES its branch, because that is the branch a first
  push must create, and `git.currentBranch` answers the same way on the Web.
- **Rename detection is off** in `git_changed_paths_between`. libgit2 would report a moved book as one
  rename; the Web layer's tree walk reports a delete and an add. The plan a translator reads is about
  paths, so both hosts say delete-and-add.
- **`git_move_branch` is a forced checkout** and refuses any branch that is not the one HEAD is on.
  **`git_abort_merge` refuses when nothing is in progress** — it is a hard reset underneath, and on a
  clean repository that would discard unsaved work rather than undo a transfer.

`src/core/git/contract.ts` is the acceptance suite, and it cannot reach this Layer: `invoke` needs a
Tauri runtime and a Node harness has none. So the contract's own case — init, empty status, one saved
file, one commit, then `log`/`show`/`previousVersions` agreeing — plus one case per command lives as
`#[cfg(test)] mod tests` in `src-tauri/src/git.rs`, against real repositories in temp directories.
`cargo test` in `src-tauri/` runs them. That is not the repository's "no tests" rule being bent: the
rule is about locking UI behaviour while the surfaces move, and nothing there renders anything.

The commit identity goes through one function, `author_signature`. Sefer has no author setting yet —
`src/app/commands.ts` passes a fixed "Sefer <sefer@localhost>" on both hosts — so that function is
the single place a real identity has to land.

## The updater

`check` → `installAndRelaunch` uses the plugin's own endpoint, verifies the download's minisign
signature and installs atomically. The manual picker (`listVersions` / `installVersion`) exists in the
port because a broken release has to be escapable; it goes through Rust, since the JS `check()` has no
endpoint override. Settings → About drives the first flow (`src/app/ui/UpdatePanel.tsx`).

Endpoints never live in the repository. `tauri.conf.json` cannot read the environment, so
`tools/tauri/updaterConfig.ts` writes `src-tauri/gen/tauri.conf.env.json` from `SEFER_UPDATER_HOST`
with `plugins.updater.endpoints: ["<host>/{{target}}/{{current_version}}"]`, and `pnpm dev:tauri` /
`pnpm build:tauri` pass it as `--config` (plus `tauri.conf.preview.json` when `SEFER_CHANNEL=preview`).
Host unset means no endpoints and a check that reports "not configured" — there is no fallback URL.
The TS side reads the same host from `VITE_SEFER_UPDATER_HOST` for the two routes the plugin does not
cover. See [configuration](configuration.md).

**Before the first release, generate a keypair**: `pnpm tauri signer generate -w ~/.sefer-updater.key`.
Put the public half in `tauri.conf.json`'s `plugins.updater.pubkey`, which today holds the placeholder
`REPLACE_WITH_MINISIGN_PUBLIC_KEY`; put the private half and its password in the
`TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD` secrets. The v1 app's key is deliberately not reused: it
signs the v1 update channel.

### If DMG bundling fails locally

`pnpm build:tauri` on macOS can die at `bundle_dmg.sh` with
`hdiutil: create failed - Resource busy`.

**Suspect the machine, not the build.** Seen on 2026-09-22, macOS 26.5.2: it
was not Tauri, create-dmg, or any flag they pass. Once it starts,
`hdiutil create -srcfolder` fails for ANY source, format and destination —
a four-byte fake app to `/tmp` fails the same way — which no amount of
bundler configuration can explain. macOS's disk-image subsystem gets into
this state and stays there; a reboot clears it.

The diagnosis is worth repeating because the first attempts SUCCEED and then
everything after fails, which reads exactly like a flag problem and is not.
The test that settles it in one line:

```sh
mkdir -p /tmp/probe && echo hi > /tmp/probe/a.txt
hdiutil create -srcfolder /tmp/probe -volname P -format UDZO /tmp/probe.dmg
```

If that fails, the machine is wedged and nothing in this repository is wrong.

**It still costs more than a DMG**, which is the part worth knowing: the DMG
step aborts bundling, so the run never reaches `Sefer.app.tar.gz` — the
artifact `workers/sefer-updater` actually serves. The DMG is only the human
download. To get the update path while the machine is unhappy:

```sh
pnpm exec tauri build --bundles app
```

That produces `Sefer.app`, `Sefer.app.tar.gz` and its `.sig`, and skips the
DMG entirely.

CI runs on a fresh macOS VM each time, so it cannot accumulate this state.

## Release

`.github/workflows/release.yml` — a `v*` tag builds Stable; a `-rc` tag or a `workflow_dispatch`
builds Preview (prerelease, product name "Sefer Preview", identifier
`org.wycliffe.sefer.preview`, which is also how the app knows its own channel).

Preview was called Nightly until 2026-09-22. It has never built on a schedule — it builds when
somebody promotes a commit — so the word described something this repository does not do, which is
roughly why nobody used it. Both desktop channels carry the full test suite and the full platform
matrix: Preview is the last rehearsal before a tag, not a place to put something broken. The web
`dev` channel is the fast one, and it is web-only for exactly that reason.
`tools/tauri/patchVersion.ts` stamps the release version into `package.json`, `tauri.conf.json` and
`Cargo.toml`; the in-tree value stays `0.0.0`. macOS builds universal, Windows and Ubuntu x86_64, and
`tauri-action` attaches the bundles and the `.sig` files to the GitHub release.

## Still missing

- **Icons are the v1 app's**, copied verbatim (`src-tauri/icons/`) — same logo by intent.
- **No code signing or notarisation.** v1 pulled Apple certificates from 1Password; Sefer has no
  signing identity yet, so macOS builds are unsigned and Gatekeeper warns.
- **No updater worker.** The Cloudflare worker that turns GitHub releases into Tauri manifests lives
  in the v1 repository (`workers/zephyr-updater`); Sefer needs its own instance before
  `SEFER_UPDATER_HOST` can point anywhere.
- **Remote progress is a final tally, not a live trickle.** git2 reports progress through callbacks
  inside one blocking command; a live readout needs the Rust side to emit Tauri events.
- **No mobile.** The Rust is `cfg`-gated for it and the icon set omits `ios/` and `android/`.
- `copy`, `chmod`, `truncate`, `utimes`, `open`, `link`/`symlink` and `glob` are unimplemented on
  `TauriFileSystemLive` and fail with a `PlatformError` naming the method, as on the other two hosts.
  Everything the contract suite (`src/core/fileSystem/contract.ts`) exercises IS implemented, temp
  directories included — which is why `$TEMP` is in the capability scope.
