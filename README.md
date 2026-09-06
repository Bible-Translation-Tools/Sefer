# Sefer

Sefer is a local-first scripture editor. Its editing authority is one canonical
UTF-8 Source per Book; parser products, diagnostics, and rendered views are
derived from that Source.

The runnable scaffold contains a shared Solid 2 frontend with TanStack Router,
a minimal Tauri v2 host, and a framework-independent `src/core` boundary. The
first screen is intentionally only a shell. Editor, storage, Git, parsing, and
proofreading work remain planned rather than implied by the scaffold.

## Commands

```sh
pnpm install
pnpm dev
pnpm dev:tauri
pnpm typecheck
pnpm lint
pnpm format:check
pnpm boundaries
pnpm test:unit
pnpm test:browser
pnpm build
pnpm build:tauri
pnpm check
```

`pnpm check` is the usual local gate: typecheck, lint, format check, the core
boundary check, Node core tests, and the Web build. Browser Mode is a separate
Chromium command, because it is only needed once browser-sensitive behavior
exists. `pnpm build:tauri` packages the desktop host and therefore needs the
local Tauri prerequisites.

Zed exposes the same checks through project tasks in `.zed/tasks.json`. Lefthook
runs them on `pre-commit`, and `.github/workflows/check.yml` runs the same
commands on every push and pull request, with `pnpm test:browser` in a second
job.

## Boundaries

- `src/core` contains domain and application policy. It must not import Solid,
  TanStack Router, Tauri, CodeMirror, DOM globals, or host implementations;
  `pnpm boundaries` enforces this. See
  [boundaries](documentation/architecture/boundaries.md).
- `src/app` composes core policy with the shared Solid UI.
- `src/platform` detects and later supplies Web or Tauri capabilities.
- `src-tauri` is the thin native host. Its default capability is only
  `core:default`; no filesystem or shell capability is granted.

Effect 4 is pinned and used for the boot program's typed failures. It is not a
general dependency container, and there is no scoped runtime yet. `isomorphic-git` and CodeMirror are pinned
dependencies for later, separately designed integration.

Specta is deferred until a native command carries a useful shared value. At
that point, bindings must be generated from Rust rather than hand-maintained.

## Documentation

Start at [the documentation index](documentation/README.md). The shared
[glossary](documentation/glossary.md) defines Source, Disk bytes, Revision,
Snapshot, Save, Recovery, Checkpoint, and Operation. Planning files remain
proposals unless their owning document says otherwise.
