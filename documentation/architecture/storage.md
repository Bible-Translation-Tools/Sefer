# Storage

The filesystem port is Effect's own `FileSystem` service (`effect/FileSystem`, re-exported from `effect`). Sefer does not define its own filesystem contract; core policy takes `FileSystem.FileSystem` and fails with `PlatformError`.

## Implementations

- **Node** — `src/platform/node/fileSystem.ts` exports `NodeFileSystemLive`, the `NodeFileSystem.layer` from `@effect/platform-node`. Present. It is the tests-and-tooling implementation; it is not shipped to a host.
- **Memory** — `src/core/fileSystem/memory.ts` exports `MemoryFileSystemLive(seed?)` and `makeMemoryFileSystem(seed?)`. Present. Paths are normalised POSIX-style; `seed(entries)` populates it, which is how the dev fixture project will be loaded. `open`, `link`, `symlink`, `readLink`, `chown`, `glob`, and `watch` are unimplemented and fail with a `PlatformError` naming the method; `stream` and `sink` derive from `open` and therefore fail too.
- **Tauri fs plugin** — planned. Desktop disk is owned by Rust; the adapter arrives with the first storage slice.
- **Web OPFS** — planned. The Web implementation must also expose the Node-shaped `fs` object isomorphic-git needs; see [plan 24](../../planning/00-ideas/v2-24-effect-filesystem-and-git-probe.md).

## Helpers

`writeFileAtomic(fileSystem, path, bytes)` in `src/core/fileSystem/atomic.ts` writes to the deterministic sibling `<path>.sefer-tmp` and then renames it over the target, so a failed write leaves the previous bytes intact. The sibling name is deterministic so a crash leaves a predictable orphan that recovery can find; Sefer serialises writes per path. On failure the sibling is removed. `rename` is an atomic replace on both present implementations.

`scopedTo(fileSystem, root)` in `src/core/fileSystem/scoped.ts` resolves every path against `root` and refuses absolute paths and any path that escapes the root with a `PlatformError` whose reason is `BadArgument`. UI and domain code receive a scoped filesystem, not raw path authority.

## Acceptance

`fileSystemContract(name, makeLayer)` in `src/core/fileSystem/contract.ts` is the acceptance test for any new implementation: register it against the new layer and it must pass unchanged. It covers byte and string round trips, `exists`, directory listing, stat kinds, remove, rename-replaces, the `NotFound` and `AlreadyExists` reasons, the atomic-write laws, and the root-scoping refusals. Every case runs against a real temporary directory obtained from `makeTempDirectoryScoped`; there are no mocks.

Observability is not wired into either layer. The meaningful span belongs to the save coordinator, not to individual filesystem calls.
