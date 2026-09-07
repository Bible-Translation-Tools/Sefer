# Application composition

Sefer has one shared frontend application and two host compositions:

```text
Web entry ─┐
           ├─ application composition ─ core policy + shared Solid UI + TanStack navigation
Tauri entry┘
           └─ native host capabilities (later: disk, Git, diagnostics)
```

The current scaffold uses the same Vite frontend for Web and Tauri. The Tauri crate creates one window with the core default capability; it does not yet expose an application command or own files, Git, parsing, or project lifecycle. The browser determines host kind from the Tauri runtime marker; this is intentionally a small boot signal rather than a general dependency injector.

Effect is available at the application/core boundary for typed failures and, later, scoped asynchronous work. `src/core/boot.ts` is the whole of it today: `boot(host, build)` validates the host kind and the injected build identity and returns `BootInfo`, or fails with the tagged `UnknownHost` or `MissingBuildIdentity`. It owns no resource, so it opens no scope. `src/app/composition.ts` runs it once with `detectHost()` and the Vite-injected `__SEFER_BUILD__`, and hands the shell a `Result` so a boot failure renders as `boot failed: <tag>` instead of throwing. A scoped Effect runtime arrives with the first real resource — storage or the editor — per [plan 01](../../planning/00-ideas/v2-01-boot-and-composition.md), not before. Add a Layer or host capability only when a concrete operation needs lifetime, failure, or replacement semantics.

Observability is the first real Layer, built before any domain module so nothing later has to be rethreaded. `src/app/composition.ts` builds `ObservabilityLive` from `src/core/observability.ts`, hands it the host sink from `src/platform/observability.ts`, and runs `boot` inside it, so the first thing the application does is already recorded. See [observability](observability.md) for the service surface, the bounded ring, and the levels.

`composeApplication(options)` is the single composition entry, and it is asynchronous because the dev-only OTLP Layer builds asynchronously. Nothing composes at import time: `src/app/composition.ts` exports the function and holds no state. The entry composes once — `src/App.tsx` top-level `await composeApplication()` — and passes the result down through `src/app/CompositionContext.tsx` (`CompositionProvider`, and `useComposition()`, which throws if there is no provider above it). Routes and components read services from `useComposition()`; the shell's boot-failed rendering reads `composition.boot` from it too. Composing twice would mean two observability rings, so nothing else in the tree calls `composeApplication`.

## The services outlive the program that boots them

The Layer's scope belongs to the application, not to `boot`. `composeApplication` builds a `ManagedRuntime.make(layer)` (Effect 4's `effect/ManagedRuntime`), runs the boot program on it with `runtime.runPromise`, and hands the runtime back on `composition.runtime` alongside `composition.dispose(): Promise<void>`. The runtime owns the scope, so a resource-owning Layer — the OTLP exporter's batching fiber today, a Galley load later — is acquired once and finalized only by `dispose()`. `Effect.runPromise(Effect.provide(program, layer))` would instead close that scope the moment `boot` returned, finalizing every resource at boot; that is the shape this replaces.

The entry composes once and never disposes: the runtime lives as long as the page. Tests dispose in `afterEach` or a `finally`, which is what keeps one test's exporter fiber out of the next test. `CompositionOptions` carries `fileSystem?: Layer<FileSystem>` and a general `layers?: Layer<never>` for anything else a caller wants merged over the root.

A page that needs a service the root does not provide merges a child Layer over the root's *built* services rather than recomposing: `composition.layer` is `Layer.succeedContext` of `runtime.context()` — the context the runtime built once and cached, not a second build — so `Effect.provide(program, Layer.merge(composition.layer, ChildLive))` reuses the same Observability ring and adds only what is new. The dev fixture page does exactly this with `FixtureFileSystemLive`, and its `reset` builds a fresh instance of that memory Layer without touching the composition.

The filesystem is not composed into the Web or Tauri root yet, because nothing consumes it. `composeApplication()` at the root provides no `FileSystem`; the dev fixture page (`src/dev/FixturePage.tsx`, reached through the dev-only `/dev/fixture` route) obtains one for its own listing Effect by merging `FixtureFileSystemLive` over `composition.layer`. The host supplies one at the first storage slice — the Tauri fs plugin adapter on desktop, OPFS on Web. Tests and tooling use the Node layer in `src/platform/node/fileSystem.ts`. See [storage](storage.md) for the port, the present implementations, and the contract suite that accepts a new one.

TanStack Router owns route matching, navigation, loaders, and route code splitting. It is not the sole owner of an open Project and is not assumed to be the dependency injection mechanism. A future composition root may pass capabilities explicitly or provide a narrowly scoped Effect Layer after the first real storage operation establishes the need.

Core code must not import Solid, TanStack Router, Tauri, CodeMirror, DOM globals, or native filesystem implementations. Host-specific modules may depend inward on core contracts; core contracts must remain usable from Node tests. See [boundaries](boundaries.md) for the rule and the checks that enforce it.

Specta is deliberately deferred. There is no Rust/TypeScript application contract in the scaffold, so there are no hand-authored invoke types to keep in sync. Revisit it when a native command carries a domain value shared with the frontend; use generated bindings then, after verifying the compatible Tauri/Specta versions.
