/**
 * The desktop host's whole surface, behind one module.
 *
 * This barrel exists for a specific reason, not for tidiness: every file it
 * re-exports imports `@tauri-apps/*`, which must never be EVALUATED in a Web
 * build. `src/app/services.ts` loads this module through a dynamic
 * `import("../platform/tauri/index")` inside the `tauri` branch of
 * `detectHost()`, so Vite emits it as a separate chunk that a browser never
 * fetches. Adding a static import of any file below to a shared module would
 * quietly undo that.
 *
 * `documentation/architecture/desktop.md` is the map of what these Layers
 * provide and which Rust commands they sit on.
 */
export { TauriCredentialsLive, KEYCHAIN_SERVICE } from "./credentials";
export { TauriDialogsLive } from "./dialogs";
export { TauriFileSystemLive, makeTauriFileSystem } from "./fileSystem";
export { TauriGitLive } from "./git";
export { TauriHostInfoLive, TAURI_CAPABILITIES, tauriPaths } from "./hostInfo";
export { TauriRemoteLive, hostOf, type TauriRemoteOptions } from "./remote";
export { TauriUpdaterLive, type TauriUpdaterOptions } from "./updater";
