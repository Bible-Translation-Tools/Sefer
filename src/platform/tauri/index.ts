import { TauriCredentialsLive } from "./credentials";
import { TauriDialogsLive } from "./dialogs";
import { TauriFileSystemLive } from "./fileSystem";
import { TauriGitLive } from "./git";
import { tauriFacts } from "./hostFacts";
import { TauriHostInfoLive, tauriPaths } from "./hostInfo";
import { TauriRemoteLive } from "./remote";
import { TauriFolderTreeLive } from "./tree";
import { TauriUpdaterLive } from "./updater";

export const tauriHost = {
  TauriCredentialsLive,
  TauriDialogsLive,
  TauriFileSystemLive,
  TauriFolderTreeLive,
  TauriGitLive,
  TauriHostInfoLive,
  TauriRemoteLive,
  TauriUpdaterLive,
  tauriPaths,
  tauriFacts,
};
