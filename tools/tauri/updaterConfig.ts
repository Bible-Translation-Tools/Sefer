/**
 * Writes the Tauri config overlay that carries the updater endpoint.
 *
 * `tauri.conf.json` cannot read the environment, and Sefer's rule is that no
 * hostname is ever committed (documentation/architecture/configuration.md). So
 * the endpoint arrives the only other way Tauri offers: a generated overlay
 * passed as `--config`.
 *
 * Reads `SEFER_UPDATER_HOST` and the optional `SEFER_CHANNEL`. When the host
 * is unset the overlay deliberately sets NO endpoints — the updater then has
 * nothing to check and `src/platform/tauri/updater.ts` reports "not
 * configured for this build", which is the honest answer for a local build.
 * There is no fallback URL to fall back to.
 *
 * The overlay is generated, not committed: `src-tauri/gen/` is ignored.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

/** The two channels the release workflow publishes. */
export type Channel = "stable" | "nightly";

export interface UpdaterOverlay {
  readonly plugins?: {
    readonly updater: {
      readonly endpoints: readonly string[];
    };
  };
}

const OVERLAY_PATH = "src-tauri/gen/tauri.conf.env.json";

/**
 * `{{target}}` and `{{current_version}}` are substituted by the updater
 * plugin itself, so they are left literal here. The trailing slash is trimmed
 * so a host given with or without one produces the same URL.
 */
export const overlayFor = (host: string | undefined): UpdaterOverlay => {
  const base = host?.trim().replace(/\/+$/u, "");
  if (base === undefined || base === "") return {};
  return { plugins: { updater: { endpoints: [`${base}/{{target}}/{{current_version}}`] } } };
};

export const channelOf = (value: string | undefined): Channel =>
  value?.trim() === "nightly" ? "nightly" : "stable";

/** Writes the overlay and returns its repository-relative path. */
export const writeUpdaterConfig = (repoRoot: string): string => {
  const overlay = overlayFor(process.env.SEFER_UPDATER_HOST);
  const destination = path.join(repoRoot, OVERLAY_PATH);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify(overlay, null, 2)}\n`, "utf8");
  return OVERLAY_PATH;
};

const main = (): void => {
  const written = writeUpdaterConfig(process.cwd());
  const channel = channelOf(process.env.SEFER_CHANNEL);
  const host = process.env.SEFER_UPDATER_HOST?.trim();
  process.stdout.write(
    `${written} written for the ${channel} channel: ${
      host === undefined || host === "" ? "no updater endpoint (SEFER_UPDATER_HOST unset)" : host
    }\n`,
  );
};

// Only when run as a script; importable for the release workflow and tests.
if (process.argv[1] !== undefined && process.argv[1].endsWith("updaterConfig.ts")) main();
