# Host capabilities

Everything Sefer cannot do by itself arrives as one of seven Effect Layers. Each has one interface in
`src/core/host/` (or, for the two that predate this seam, in `src/core/`) and one implementation per
host in `src/platform/{web,tauri,node}/`. Core policy asks the service; only `src/platform` names a
host, and `pnpm boundaries` enforces that direction.

| Layer | Interface | Web | Tauri | Tests / dev |
| --- | --- | --- | --- | --- |
| HostInfo | `src/core/host/hostInfo.ts` | `WebHostInfoLive(build)` | `TauriHostInfoLive(build)` | `HostInfoLive(values)` |
| FileSystem | `effect/FileSystem` | `OpfsFileSystemLive` | `TauriFileSystemLive` | `MemoryFileSystemLive`, `NodeFileSystemLive` |
| Observability | `src/core/observability.ts` | `ObservabilityLive({ sink: hostSink() })` | same | same |
| Settings | `src/core/host/settings.ts` | `SettingsLive` | `SettingsLive` | — |
| Credentials | `src/core/host/credentials.ts` | `WebCredentialsLive` (`localStorage`) | `TauriCredentialsLive` (OS keychain) | — |
| Dialogs | `src/core/host/dialogs.ts` | `WebDialogsLive` | `TauriDialogsLive` | — |
| Updater | `src/core/host/updater.ts` | `NoUpdaterLive(build)` | `TauriUpdaterLive({ updaterHost })` | `NoUpdaterLive(build)` |

## What each one owns

**HostInfo** widens `boot()`'s host and build into the whole set of host facts: `kind()`, `build()`,
`paths()` (appData, logs, cache, temp — POSIX names, existence not implied), `locale()`, and
`capabilities()` (`nativeDisk`, `nativeGit`, `fsWatch`, `dialogs`, `secureStore`). A flow asks
`capabilities()` before offering itself rather than failing halfway. Web paths are OPFS paths under
`/sefer`, so everything Sefer writes in a browser is one removable subtree.

**Settings** is register-then-read: a module declares the key it owns with a schema and a default and
keeps the returned `SettingKey<S>`. `get` is synchronous over decoded values; `set` validates,
persists, then publishes to `changes(key)`. One JSON file at `<appData>/settings.json`, read once at
Layer build, written whole with `writeFileAtomic`, with unregistered keys carried through untouched.
A stored value that no longer matches its schema is noted `settings/refused` and the default stands —
a hand-edited file cannot stop the application from starting.

**Credentials** is keyed by the endpoint's origin (the normalised host of the remote URL), one
credential per host. Web keeps it in `localStorage`, which survives a reload and is only as safe as the
page itself; desktop uses the OS keychain. A token is never written to project files or settings.

**Dialogs** is the four questions every open, import, save and destructive flow needs. Web uses
`confirm` and the File System Access pickers when present, and answers `None`/`[]`/`false` with a note
when not. Its pickers yield handle names, not paths; mapping a picked handle to a path an OPFS
`FileSystem` can read belongs to the project/library slice, and is marked `TODO(seam)` in
`src/platform/web/dialogs.ts`. `pickSaveFile(title, suggestedName, filters)` is the one member Web
answers `None` to on purpose rather than for want of a browser feature: a browser has no path to
give back, so the caller downloads the same bytes instead ([git.md](git.md), ProjectAdmin).

**Updater** is how a running Sefer replaces itself. Only the desktop host can, so the Web Layer is a
real implementation that refuses: `check()` answers `Unavailable` with a reason to display, and every
install path fails loudly. That is why the About panel is written once and rendered on both hosts.
`check()` cannot fail — "we could not find out" is an answer the panel shows, not an error the shell
handles — while installing can, because it either happened or it did not.

## Both hosts are real

The `src/platform/tauri/` Layers are implemented over the Tauri plugins and the Rust commands in
`src-tauri/`; see [desktop host](desktop.md) for the command vocabulary and what is still missing.
`src/app/services.ts` chooses by `detectHost()` and reaches the desktop Layers through a dynamic
`import()`, so the Web bundle never evaluates `@tauri-apps/*`.

## How composition merges them

`src/app/composition.ts` still owns only boot and Observability ([composition](composition.md)). The
host Layers are merged one ring out, in `src/app/services.ts`, and the six besides Observability are all provided —
`composeServices()` cannot return without them, because `HostInfo` and `FileSystem` are what every
rooted module reads its root from.

`detectHost()` decides once, and the desktop Layers arrive through a dynamic `import()` of
`src/platform/tauri/index` inside that branch and nowhere else, so a Web bundle never evaluates — or
even fetches — `@tauri-apps/*`. The type is named as `typeof import(...)`, which is erased.

What `domainLayer(build, fixture, paths, tauri)` wires, in dependency order:

- **HostInfo** — `WebHostInfoLive(build)` or `TauriHostInfoLive(build)`, where `build` is read off the
  boot result the composition already validated rather than from `__SEFER_BUILD__` a second time.
- **FileSystem** — `OpfsFileSystemLive` or `TauriFileSystemLive`, and `FixtureFileSystemLive` on either
  host when `?fixture=1` asked for the seeded project.
- **Credentials** — `WebCredentialsLive` on Web (`localStorage`: survives a reload, as safe as the page
  itself; `src/platform/web/credentials.ts` says why) or `TauriCredentialsLive` over the OS keychain. `GiteaLive` is provided *over* it
  (`Layer.provideMerge`), because Gitea needs the credential store and the browser's `fetch`.
- **Dialogs** — `WebDialogsLive` (File System Access API) or `TauriDialogsLive` (native pickers).
- **Updater** — `NoUpdaterLive(build)`, which refuses honestly, or `TauriUpdaterLive`.
- **Galley** — `WebGalleyLive` on both: the wasm engine runs in the webview, not in Rust, so there is
  nothing host-specific to swap.

Those are merged as one `host` Layer with the FileSystem, and every core module is provided over it:
`Layer.provideMerge(modules, Layer.merge(host, fileSystem))`. `SettingsLive` therefore finds the
`HostInfo` and `FileSystem` it needs without being wired to them by hand, and the same is true of
Recovery's and Library's roots, which are passed as plain strings resolved from `paths` before the
Layers are built (`WEB_PATHS`, or `await tauriPaths()`).

Both host branches merge the same shape, so nothing above `composeServices` learns which host it is
on: the shell reads `hostInfo.kind()` when it wants to *say* which one, never to decide behaviour.
See [the shell](shell.md), [boundaries](boundaries.md) and [storage](storage.md).
