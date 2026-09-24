/**
 * The desktop half of `HostFacts`: the OS as `plugin-os` reports it and the
 * installed version from the bundle, over the browser half's WebView and user
 * agent.
 */
import { getVersion } from "@tauri-apps/api/app";
import { arch, platform, version } from "@tauri-apps/plugin-os";

import type { HostFacts } from "#core/diagnostics/header";

export const tauriFacts = async (browser: HostFacts): Promise<HostFacts> => ({
  ...browser,
  os: platform(),
  osVersion: version(),
  arch: arch(),
  version: await getVersion(),
});
