# Application composition

Sefer has one shared frontend application and two host compositions:

```text
Web entry ─┐
           ├─ application composition ─ core policy + shared Solid UI + TanStack navigation
Tauri entry┘
           └─ host capabilities: filesystem, Git, credentials, dialogs, updater
```

Web and Tauri run the same Vite frontend. The browser determines host kind from the Tauri runtime marker (`detectHost()`), a small boot signal rather than a general dependency injector. What each host supplies is in [host capabilities](host.md); the desktop side and its Rust commands are in [desktop host](desktop.md).

This page covers the root: boot, the one runtime, and `composition.layer`. The domain Layers that go on top of it — `composeServices`, which loads the Web or the Tauri Layers — are in [the application shell](shell.md).

## Boot

`src/core/boot.ts` `boot(host, build)` validates the host kind and the injected build identity and returns `BootInfo`, or fails with the tagged `UnknownHost` or `MissingBuildIdentity`. It owns no resource, so it opens no scope. `src/app/composition.ts` runs it once with `detectHost()` and the Vite-injected `__SEFER_BUILD__`, and hands the shell a `Result` so a boot failure renders as `boot failed: <tag>` instead of throwing.

Observability is built before anything else, so the first thing the application does is already recorded: the composition builds `ObservabilityLive` from `src/core/observability.ts`, hands it the host sink from `src/platform/observability.ts`, and runs `boot` inside it. See [observability](observability.md).

`composeApplication(options)` is the single composition entry, and it is asynchronous because the dev-only OTLP bridge builds asynchronously. Nothing composes at import time. `src/App.tsx` composes once, with top-level `await composeApplication()`, and passes the result down through `src/app/CompositionContext.tsx` (`CompositionProvider`, and `useComposition()`, which throws if there is no provider above it). Composing twice would mean two observability rings, so nothing else in the tree calls `composeApplication`.

## The services outlive the program that boots them

The Layer's scope belongs to the application, not to `boot`. `composeApplication` builds a `ManagedRuntime.make(layer)`, runs the boot program on it, and hands the runtime back on `composition.runtime` alongside `composition.dispose(): Promise<void>`. The runtime owns the scope, so a resource-owning Layer is acquired once and finalized only by `dispose()`. `Effect.runPromise(Effect.provide(program, layer))` would instead close that scope the moment `boot` returned.

The entry composes once and never disposes: the runtime lives as long as the page. Tests dispose in `afterEach` or a `finally`. `CompositionOptions` carries `fileSystem?: Layer<FileSystem>` and a general `layers?: Layer<never>` for anything else a caller wants merged over the root.

A page that needs a service the root does not provide merges a child Layer over the root's _built_ services rather than recomposing: `composition.layer` is `Layer.succeedContext` of `runtime.context()` — the context the runtime built once — so `Effect.provide(program, Layer.merge(composition.layer, ChildLive))` reuses the same Observability ring and adds only what is new. The dev fixture page does exactly this with `FixtureFileSystemLive`.

TanStack Router owns route matching, navigation, loaders, and route code splitting. It is not the dependency injection mechanism; services reach components through `useComposition()` and the shell's services.

Core code must not import Solid, TanStack Router, Tauri, CodeMirror, DOM globals, or native filesystem implementations; see [boundaries](boundaries.md).

## The Tauri invoke contract is hand-typed

The desktop adapters in `src/platform/tauri/` call the Rust commands through hand-typed `invoke<T>(…)` wrappers; there are no generated bindings. Specta is deferred until the command surface is large enough to drift — roughly thirty commands, or a second author on `git.rs`. It has 23 today.
