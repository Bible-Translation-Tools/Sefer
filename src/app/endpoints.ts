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

import { channelOf } from "#core/diagnostics/header";
import type { SettingsService } from "#core/host/settings";
import { NO_TRANSPORT, parseTransport, type Transport } from "#core/remote/transport";

import { cleanUrl, env } from "./env";
import { shellKeys } from "./settings";

/** Which host we are running on; `HostInfo.kind()` answers it. */
export type HostKind = "web" | "tauri";

export interface ResolvedEndpoints {
  /** The content host: sign-in, the repository list, and where a publish goes. */
  readonly contentHost: string | null;
  /** The catalogue the projects page lists. */
  readonly catalogueUrl: string | null;
  /** The Web transport's pairs, as text. */
  readonly webTransport: string;
}

/**
 * The content host in force: the preference if someone set one, otherwise
 * this build's. The same on both hosts — it is an identity, and only the
 * Web's TRANSPORT differs (`transportFor`).
 *
 * Read at CALL time, so a screen that gates on "is the cloud configured"
 * updates as soon as the box is filled in. The services that transfer are the
 * other half of the story — see `rememberBootEndpoints`.
 */
export const contentHostFor = (settings: SettingsService): string | null =>
  cleanUrl(settings.get(shellKeys(settings).contentHost)) ?? env.contentHost;

export const catalogueUrlFor = (settings: SettingsService): string | null =>
  cleanUrl(settings.get(shellKeys(settings).catalogueUrl)) ?? env.catalogueUrl;

export const resolveEndpoints = (settings: SettingsService): ResolvedEndpoints => ({
  contentHost: contentHostFor(settings),
  catalogueUrl: catalogueUrlFor(settings),
  webTransport: transportSpecFor(settings),
});

/**
 * This build's own value for each network preference, before any override —
 * what the settings screen offers to go back to.
 */
export const BUILD_ENDPOINTS: ResolvedEndpoints = {
  contentHost: env.contentHost,
  catalogueUrl: env.catalogueUrl,
  webTransport: env.webTransport,
};

/**
 * The Web transport's pairs as text: the preference if someone set one in
 * Advanced, otherwise this build's. Each proxy is pinned to one upstream, so
 * this is infrastructure rather than a choice — a wrong pair breaks every
 * transfer to that host — and it is editable only because a flags screen is
 * where somebody debugging a proxy goes.
 */
const transportSpecFor = (settings: SettingsService): string =>
  settings.get(shellKeys(settings).webTransport).trim() || env.webTransport;

/** How this host reaches a content host: the proxy pairs on the Web, nothing on desktop. */
export const transportFor = (settings: SettingsService, host: HostKind): Transport =>
  host === "web" ? parseTransport(transportSpecFor(settings)) : NO_TRANSPORT;

/**
 * What the proxies expect in `X-Requested-With`, derived from the channel
 * this build is: `sefer-prod`, `sefer-preview`, `sefer-dev`, and `sefer-local`
 * under the dev server. A label, not a credential — it ships in the bundle —
 * so its only job is telling the proxy's logs and allowlist which build
 * called, which the channel already says.
 */
export const appIdFor = (build: string): string => {
  const channel = channelOf(build);
  if (channel === "production") return "sefer-prod";
  if (channel === "development") return "sefer-local";
  return `sefer-${channel}`;
};

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

/**
 * The Web transport the composition was built with, for the one consumer that
 * is built before `Settings` exists: the Gitea API's fetch, in the host ring.
 * Read per request, so it answers with the boot value once there is one and
 * the build's until then — the same pairs `WebRemoteLive` was given, so the
 * API and git never disagree about how a host is reached.
 */
export const bootTransport = (): Transport =>
  parseTransport(booted?.webTransport ?? env.webTransport);

/** Whether a reload would change what a transfer or a catalogue read does. */
export const endpointsChangedSinceBoot = (settings: SettingsService): boolean => {
  const at = booted;
  if (at === null) return false;
  const now = resolveEndpoints(settings);
  return (
    now.contentHost !== at.contentHost ||
    now.catalogueUrl !== at.catalogueUrl ||
    now.webTransport !== at.webTransport
  );
};
