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
| `Dialogs`                              | `TauriDialogsLive`                  | `plugin-dialog`; returns real absolute paths, unlike the Web pickers              |
| `Credentials`                          | `TauriCredentialsLive`              | `credentials_*` commands over the `keyring` crate, service `org.wycliffe.sefer`   |
| `Git`                                  | `TauriGitLive`                      | `git_*` commands over `git2`                                                      |
| `Remote`                               | `TauriRemoteLive({ giteaHost })`    | `git_ensure_remote/fetch/pull/push`; `publish` needs `Gitea` for repo creation    |
| `Updater` (`src/core/host/updater.ts`) | `TauriUpdaterLive({ updaterHost })` | `plugin-updater` + `install_update_from_endpoint`                                 |

`src/app/services.ts` picks these by `detectHost()` and loads them through a dynamic
`import("../platform/tauri/index")` inside the `tauri` branch only. That is load-bearing: every file
behind that barrel imports `@tauri-apps/*`, and a static import would put the plugins in the Web
bundle. `pnpm build` currently emits them as their own chunk that a browser never fetches.

## Plugins and capabilities

`fs`, `dialog`, `os`, `opener` on every target; `updater`, `process`, `window-state` on desktop only
(mobile ships through app stores). `src-tauri/capabilities/default.json` enables the fs commands the
FileSystem layer calls and grants their paths ONCE through `fs:scope`, over `$APPDATA`,
`$APPLOCALDATA`, `$DOCUMENT` and `$HOME`. Each base is listed four times — bare, `/**`, `/**/.*` and
`/**/.*/**` — because a glob does not match a leading dot and every project contains a `.git`.
Projects live in the user's own folders on desktop, so the scope is broad; it is still explicit, and a
path outside it comes back as `PermissionDenied` rather than as a silent empty read.

## Rust commands

`git_open/init/status/commit/log/previous_versions/show` answer the `Git` port;
`git_ensure_remote/remote_url/fetch/pull/push` answer `Remote`; `credentials_get/set/clear` answer
`Credentials`; `install_update_from_endpoint` serves the manual version switch.

Every command returns `Result<T, String>` where the string is `"<Reason>: <detail>"` — the vocabulary
is in `src-tauri/src/errors.rs` (`NotARepository`, `Io`, `Conflict`, `Refused`, `AuthFailed`,
`Offline`, `Rejected`). The TS adapters read only the prefix, so libgit2's prose can change without
breaking the mapping. `remote_callbacks_for_token` and the transport classifier are ported from the v1
app. `commit` stages exactly the receipt paths — no `add_all` — and both sides check the path is
inside the work tree. `pull` fast-forwards or reports `Conflict`: Sefer never merges USFM behind a
translator's back.

## The updater

`check` → `installAndRelaunch` uses the plugin's own endpoint, verifies the download's minisign
signature and installs atomically. The manual picker (`listVersions` / `installVersion`) exists in the
port because a broken release has to be escapable; it goes through Rust, since the JS `check()` has no
endpoint override. Settings → About drives the first flow (`src/app/ui/UpdatePanel.tsx`).

Endpoints never live in the repository. `tauri.conf.json` cannot read the environment, so
`tools/tauri/updaterConfig.ts` writes `src-tauri/gen/tauri.conf.env.json` from `SEFER_UPDATER_HOST`
with `plugins.updater.endpoints: ["<host>/{{target}}/{{current_version}}"]`, and `pnpm dev:tauri` /
`pnpm build:tauri` pass it as `--config` (plus `tauri.conf.nightly.json` when `SEFER_CHANNEL=nightly`).
Host unset means no endpoints and a check that reports "not configured" — there is no fallback URL.
The TS side reads the same host from `VITE_SEFER_UPDATER_HOST` for the two routes the plugin does not
cover. See [configuration](configuration.md).

**Before the first release, generate a keypair**: `pnpm tauri signer generate -w ~/.sefer-updater.key`.
Put the public half in `tauri.conf.json`'s `plugins.updater.pubkey`, which today holds the placeholder
`REPLACE_WITH_MINISIGN_PUBLIC_KEY`; put the private half and its password in the
`TAURI_SIGNING_PRIVATE_KEY` / `_PASSWORD` secrets. The v1 app's key is deliberately not reused: it
signs the v1 update channel.

## Release

`.github/workflows/release.yml` — a `v*` tag builds Stable, the nightly schedule builds Nightly
(prerelease, `nightly-<version>`, product name "Sefer Nightly", identifier
`org.wycliffe.sefer.nightly`, which is also how the app knows its own channel).
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
