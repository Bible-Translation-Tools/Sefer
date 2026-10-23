import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

export type Channel = "stable" | "preview";

export interface UpdaterOverlay {
  readonly plugins?: {
    readonly updater: {
      readonly endpoints: readonly string[];
    };
  };
}

const OVERLAY_PATH = "src-tauri/gen/tauri.conf.env.json";

export const overlayFor = (host: string | undefined): UpdaterOverlay => {
  const base = host?.trim().replace(/\/+$/u, "");
  if (base === undefined || base === "") return {};
  return { plugins: { updater: { endpoints: [`${base}/{{target}}/{{current_version}}`] } } };
};

export const channelOf = (value: string | undefined): Channel =>
  value?.trim() === "preview" ? "preview" : "stable";

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

if (process.argv[1] !== undefined && process.argv[1].endsWith("updaterConfig.ts")) main();
