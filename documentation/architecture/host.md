# Host capabilities

Everything Sefer cannot do by itself arrives as one of six Effect Layers. Each has one interface in
`src/core/host/` (or, for the two that predate this seam, in `src/core/`) and one implementation per
host in `src/platform/{web,tauri,node}/`. Core policy asks the service; only `src/platform` names a
host, and `pnpm boundaries` enforces that direction.

| Layer | Interface | Web | Tauri | Tests / dev |
| --- | --- | --- | --- | --- |
| HostInfo | `src/core/host/hostInfo.ts` | `WebHostInfoLive(build)` | stub, dies on build | `HostInfoLive(values)` |
| FileSystem | `effect/FileSystem` | `OpfsFileSystemLive` | not written yet | `MemoryFileSystemLive`, `NodeFileSystemLive` |
| Observability | `src/core/observability.ts` | `ObservabilityLive({ sink: hostSink() })` | same | same |
| Settings | `src/core/host/settings.ts` | `SettingsLive` | `SettingsLive` | `MemorySettingsLive` |
| Credentials | `src/core/host/credentials.ts` | `SessionCredentialsLive` | stub, dies on build | `SessionCredentialsLive` |
| Dialogs | `src/core/host/dialogs.ts` | `WebDialogsLive` | stub, dies on build | `HeadlessDialogsLive(answers)` |

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

## Stubs fail loudly

The three `src/platform/tauri/` Layers die on build with a message naming the missing dependency
(`@tauri-apps/api`, the dialog plugin, a keychain plugin). Answering with guessed app directories, or
quietly falling back to a session credential map, would look like success and write to the wrong
place. Nothing composes them yet.

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
