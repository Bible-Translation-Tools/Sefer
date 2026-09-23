// endpoints.ts
//
// Which hosts this build talks to, once a preference is allowed to disagree
// with the build.
//
// `env.ts` stays the only reader of `import.meta.env` and is still the place a
// hostname enters the application; what changed is that its values are now
// DEFAULTS rather than the last word. A person testing a deployed build needs
// to be able to point it at the dev content host without waiting for a
// release, and a self-hoster needs to point it at their own — neither is a
// reason to rebuild.
//
// The rule from documentation/architecture/configuration.md survives intact:
// there is exactly one reader of the environment, exactly one reader of the
// override, and no fallback literal anywhere. An endpoint nobody configured is
// still `null`, and the feature that needs it still says so rather than
// guessing a host.
//
// Empty is not a value. A stored override of `""` means "use this build's
// default", which is what makes clearing the box in the settings screen an
// answer rather than a way to break the application.

import type { SettingsService } from "../core/host/settings";
import { cleanUrl, env } from "./env";
import { shellKeys } from "./settings";

/** Which host we are running on; `HostInfo.kind()` answers it. */
export type HostKind = "web" | "tauri";

export interface ResolvedEndpoints {
  /** The WACS endpoint: transfers and the Gitea API alike. */
  readonly wacsUrl: string | null;
  /** Language names, directions, and the catalogue the landing screen lists. */
  readonly languageApiUrl: string | null;
}

const buildDefault = (host: HostKind): string | null =>
  host === "tauri" ? env.wacsDesktopUrl : env.wacsWebUrl;

/**
 * The WACS endpoint in force: the preference if someone set one, otherwise
 * this build's.
 *
 * Read at CALL time, so a screen that gates on "is the cloud configured"
 * updates as soon as the box is filled in. The services that transfer are the
 * other half of the story — see `rememberBootEndpoints`.
 */
export const wacsUrlFor = (settings: SettingsService, host: HostKind): string | null =>
  cleanUrl(settings.get(shellKeys(settings).wacsUrl)) ?? buildDefault(host);

export const languageApiUrlFrom = (settings: SettingsService): string | null =>
  cleanUrl(settings.get(shellKeys(settings).languageApiUrl)) ?? env.languageApiUrl;

export const resolveEndpoints = (settings: SettingsService, host: HostKind): ResolvedEndpoints => ({
  wacsUrl: wacsUrlFor(settings, host),
  languageApiUrl: languageApiUrlFrom(settings),
});

/**
 * What the composition actually captured, and why there is a Reload button.
 *
 * `composeApplication()` runs once and the service Layers close over the
 * values they were given: `WebRemoteLive` holds a string, not a reader. So
 * changing an endpoint in the settings screen changes what the SCREENS see
 * immediately and what a TRANSFER does not — until the page is reloaded.
 *
 * Rather than pretend otherwise, the boot values are recorded here so the
 * settings screen can compare them against the current ones and offer a
 * reload exactly when the two have drifted apart.
 *
 * TODO(2026-09-22): threading `() => string | null` through `WebRemoteLive`
 * and `GiteaLive` would make the endpoint live and delete this — `wireFor`
 * already runs per transfer, so that half is nearly free. `catalogue.ts`
 * picking sample-vs-real at module scope is the part that is not. Worth doing
 * if the reload starts to annoy anybody.
 */
let booted: ResolvedEndpoints | null = null;

export const rememberBootEndpoints = (resolved: ResolvedEndpoints): void => {
  booted ??= resolved;
};

/** Whether a reload would change what a transfer or a catalogue read does. */
export const endpointsChangedSinceBoot = (settings: SettingsService, host: HostKind): boolean => {
  const at = booted;
  if (at === null) return false;
  const now = resolveEndpoints(settings, host);
  return now.wacsUrl !== at.wacsUrl || now.languageApiUrl !== at.languageApiUrl;
};
