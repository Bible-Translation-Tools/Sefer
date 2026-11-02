import { Result, Schema } from "effect";

import { env } from "./env";

/**
 * The desktop installers of this build's channel, for the web app's
 * "Download Desktop Version" card: the updater worker's `/downloads`
 * (`workers/sefer-updater`), which reads the channel's latest release off
 * GitHub with a token and by tag, not GitHub's "latest" (every release so far
 * is a pre-release, which `/releases/latest` never returns).
 */

export type DesktopPlatform = "mac" | "windows" | "linux";

const Downloads = Schema.Struct({
  version: Schema.String,
  published_at: Schema.String,
  builds: Schema.Array(
    Schema.Struct({
      platform: Schema.Literals(["mac", "windows", "linux"]),
      name: Schema.String,
      url: Schema.String,
      size: Schema.Number,
    }),
  ),
});

export type DesktopDownloads = typeof Downloads.Type;

const decode = Schema.decodeUnknownResult(Downloads);

/** Whether this build knows where its channel's downloads are; a local dev server does not. */
export const downloadsConfigured = (): boolean => env.updaterHost !== null;

/** The latest release's installers. Throws on a network failure or a reply that is not one. */
export const latestDownloads = async (): Promise<DesktopDownloads> => {
  const host = env.updaterHost;
  if (host === null) throw new Error("no updater host configured for this build");
  const response = await fetch(`${host}/downloads`, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`the updater answered ${response.status}`);
  const decoded = decode(await response.json());
  if (Result.isFailure(decoded)) throw new Error("the updater's reply was not a list of downloads");
  return decoded.success;
};
