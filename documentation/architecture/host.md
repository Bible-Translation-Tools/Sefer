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
| Settings | `src/core/host/settings.ts` | `SettingsLive` | `SettingsLive` | `MemorySettingsLive` |
| Credentials | `src/core/host/credentials.ts` | `SessionCredentialsLive` | `TauriCredentialsLive` (OS keychain) | `SessionCredentialsLive` |
| Dialogs | `src/core/host/dialogs.ts` | `WebDialogsLive` | `TauriDialogsLive` | `HeadlessDialogsLive(answers)` |
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

**Credentials** is keyed by remote name. Web is session-only by design: a browser has nowhere
trustworthy to persist a token, so it is never written to project files or settings.

**Dialogs** is the three questions every open, import and destructive flow needs. Web uses
`confirm` and the File System Access pickers when present, and answers `None`/`[]`/`false` with a note
when not. Its pickers yield handle names, not paths; mapping a picked handle to a path an OPFS
`FileSystem` can read belongs to the project/library slice, and is marked `TODO(seam)` in
`src/platform/web/dialogs.ts`.

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

## How composition should merge them

`composeApplication()` builds Observability today and provides no other host Layer, because nothing
consumes one ([composition](composition.md)). The host capabilities go in as one merged Layer when the
first consumer lands, in dependency order:

- `HostInfoLive` — from `WebHostInfoLive(buildIdentity())` on Web; it needs the same build identity
  `boot` already validates, so composition should pass the validated `BootInfo.build` rather than
  re-reading `__SEFER_BUILD__`.
- `FileSystem` — already an option on `CompositionOptions`.
- `SettingsLive` needs both of the above: `Layer.provide(SettingsLive, Layer.merge(hostInfo, fileSystem))`.
- `SessionCredentialsLive` and `WebDialogsLive` need nothing, and read Observability when it is there.

Both host entries merge the same shape, so nothing above the composition root learns which host it is
on. See [boundaries](boundaries.md) and [storage](storage.md).
