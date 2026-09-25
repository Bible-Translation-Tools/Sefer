/**
 * The desktop host's whole surface, behind one module.
 *
 * This barrel exists for a specific reason, not for tidiness: every file it
 * gathers imports `@tauri-apps/*`, which must never be EVALUATED in a Web
 * build. `src/app/services.ts` loads this module through a dynamic
 * `import("../platform/tauri/index")` inside the `tauri` branch of
 * `detectHost()`, so Vite emits it as a separate chunk that a browser never
 * fetches. Adding a static import of any file below to a shared module would
 * quietly undo that.
 *
 * `documentation/architecture/desktop.md` is the map of what these Layers
 * provide and which Rust commands they sit on.
 */
import { TauriCredentialsLive } from "./credentials";
import { TauriDialogsLive } from "./dialogs";
import { TauriFileSystemLive } from "./fileSystem";
import { TauriGitLive } from "./git";
import { tauriFacts } from "./hostFacts";
import { TauriHostInfoLive, tauriPaths } from "./hostInfo";
import { TauriRemoteLive } from "./remote";
import { TauriUpdaterLive } from "./updater";

/**
 * What the desktop host provides, as one object.
 *
 * One named export rather than a list of them because `services.ts` reaches
 * this module only through `await import()`: reading members off the module
 * namespace is invisible to static analysis (fallow reported every Layer here
 * as unused), whereas destructuring `tauriHost` at the import is not — and a
 * single object is also the plainest statement of the host's contract.
 */
export const tauriHost = {
  TauriCredentialsLive,
  TauriDialogsLive,
  TauriFileSystemLive,
  TauriGitLive,
  TauriHostInfoLive,
  TauriRemoteLive,
  TauriUpdaterLive,
  tauriPaths,
  tauriFacts,
};
