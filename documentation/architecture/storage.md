# Storage

The filesystem port is Effect's own `FileSystem` service (`effect/FileSystem`, re-exported from `effect`). Sefer does not define its own filesystem contract; core policy takes `FileSystem.FileSystem` and fails with `PlatformError`.

## Implementations

- **Node** — `src/platform/node/fileSystem.ts` exports `NodeFileSystemLive`, the `NodeFileSystem.layer` from `@effect/platform-node`. Present. It is the tests-and-tooling implementation; it is not shipped to a host.
- **Memory** — `src/core/fileSystem/memory.ts` exports `MemoryFileSystemLive(seed?)` and `makeMemoryFileSystem(seed?)`. Present. Paths are normalised POSIX-style; `seed(entries)` populates it, which is how the dev fixture project will be loaded. `open`, `link`, `symlink`, `readLink`, `chown`, `glob`, and `watch` are unimplemented and fail with a `PlatformError` naming the method; `stream` and `sink` derive from `open` and therefore fail too.
- **Tauri fs plugin** — planned. Desktop disk is owned by Rust; the adapter arrives with the first storage slice.
- **Web OPFS** — `src/platform/web/fileSystem.ts` exports `OpfsFileSystemLive` and `makeOpfsFileSystem()` over the Origin Private File System (`navigator.storage.getDirectory()`). Present, not yet wired into composition. Paths are POSIX-style under the OPFS root and are normalised by the same `path.ts` helpers the memory layer uses. `chmod`, `chown`, `copy`, `glob`, `link`, `makeTempFile`, `makeTempFileScoped`, `open`, `readLink`, `symlink`, `truncate`, `utimes`, and `watch` are unimplemented and fail with a `PlatformError` naming the method; `stream` and `sink` derive from `open` and therefore fail too.

## Helpers

`writeFileAtomic(fileSystem, path, bytes)` in `src/core/fileSystem/atomic.ts` writes to the deterministic sibling `<path>.sefer-tmp` and then renames it over the target, so a failed write leaves the previous bytes intact. The sibling name is deterministic so a crash leaves a predictable orphan that recovery can find; Sefer serialises writes per path. On failure the sibling is removed. `rename` is an atomic replace on all three implementations; see the OPFS note below for how the Web layer achieves it.

### OPFS rename

OPFS has no rename primitive. `rename` uses `FileSystemFileHandle.move(parentDirectory, name)` when it is present — feature-detected per call with `typeof handle.move === "function"` — which is a single atomic replace from the reader's view. Chromium ships `move`; the contract suite runs against the real API in Browser Mode, so the fallback is not the tested path there.

When `move` is absent the fallback for a file is copy-then-remove: the source bytes are written to the target through `createWritable()`, whose `close()` swaps the completed file in, and the source entry is then removed. A reader therefore sees either the previous target bytes or the complete new bytes — never a torn file — but the pair is not atomic: a crash between `close()` and the source removal leaves both the target and an orphan source. That is the exposure `writeFileAtomic`'s deterministic `.sefer-tmp` sibling is named for, so recovery can find it. With `move` absent, renaming a *directory* is refused with a `PlatformError` naming the method; there is no non-atomic directory-move fallback.

### Web Git and the Buffer global

`nodeFsView(fileSystem, run)` in `src/core/fileSystem/nodeView.ts` is the single bridge from `effect/FileSystem` to the Node-shaped promises object isomorphic-git accepts (`readFile, writeFile, unlink, readdir, mkdir, rmdir, stat, lstat, rename, readlink, symlink`). It is written against the port, not against a host, so it serves OPFS on the Web and the memory layer under Node. `PlatformError` is translated to Node-style errors carrying `code` — `ENOENT`, `EEXIST`, `ENOTDIR`, `EISDIR` — because isomorphic-git branches on `err.code`. Stat results carry the S_IFMT type bits that Node reports and isomorphic-git's `normalizeMode` expects.

isomorphic-git 1.38.4 reads a global `Buffer` (`Buffer.from`, `Buffer.alloc`, `Buffer.concat`, `Buffer.isBuffer`) and no bundler supplies one to a browser build. The Web host must install one before calling into Git; `src/platform/web/git.browser.test.ts` does so from the `buffer` package, which is the reason that package is a dependency.

`scopedTo(fileSystem, root)` in `src/core/fileSystem/scoped.ts` resolves every path against `root` and refuses absolute paths and any path that escapes the root with a `PlatformError` whose reason is `BadArgument`. `glob` takes a pattern, not a path, so it is judged on its own text: a pattern that starts with `/` or contains a `..` segment is refused before the host sees it, and `options.root` goes through the same check every path does. UI and domain code receive a scoped filesystem, not raw path authority.

`scopedTo` is **lexical confinement against programming errors, not a security boundary**. It reasons about path text only: it does not call `realPath`, does not follow symlinks, and a symlink inside the root that points outside it is followed by the host. Host-enforced scope is the authority — the Tauri plugin's scope configuration on desktop, OPFS origin isolation on the Web. Treat a `scopedTo` refusal as a caught bug, never as a defence against a hostile path.

## Acceptance

`fileSystemContract(name, makeLayer)` in `src/core/fileSystem/contract.ts` is the acceptance test for any new implementation: register it against the new layer and it must pass unchanged. All three implementations — memory, Node, and OPFS — pass all seventeen laws with no capability flag; OPFS runs the suite in Chromium Browser Mode from `src/platform/web/fileSystem.browser.test.ts`, against real OPFS storage in a temporary directory the test scope removes. It covers byte and string round trips, `exists`, directory listing, stat kinds, remove, rename-replaces, the `NotFound` and `AlreadyExists` reasons, the atomic-write laws, and the root-scoping refusals. Every case runs against a real temporary directory obtained from `makeTempDirectoryScoped`; there are no mocks.

`src/platform/web/git.browser.test.ts` is the Web Git probe: real isomorphic-git over `nodeFsView(OPFS)` performs `init`, `add`, `commit`, `log`, and `readBlob` against bytes written through the Effect `FileSystem`. It passes. Desktop does not use isomorphic-git: it answers the Git port with git2 ([git](git.md), [desktop](desktop.md)).

Observability is not wired into any layer. The meaningful span belongs to the save coordinator, not to individual filesystem calls.
