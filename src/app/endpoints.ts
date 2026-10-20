import { channelOf } from "#core/diagnostics/header";
import type { SettingsService } from "#core/host/settings";
import { NO_TRANSPORT, parseTransport, type Transport } from "#core/remote/transport";

import { cleanUrl, env } from "./env";
import { shellKeys } from "./settings";

export type HostKind = "web" | "tauri";

export interface ResolvedEndpoints {
  readonly contentHost: string | null;
  readonly catalogueUrl: string | null;
  readonly webTransport: string;
}

export const contentHostFor = (settings: SettingsService): string | null =>
  cleanUrl(settings.get(shellKeys(settings).contentHost)) ?? env.contentHost;

export const catalogueUrlFor = (settings: SettingsService): string | null =>
  cleanUrl(settings.get(shellKeys(settings).catalogueUrl)) ?? env.catalogueUrl;

export const resolveEndpoints = (settings: SettingsService): ResolvedEndpoints => ({
  contentHost: contentHostFor(settings),
  catalogueUrl: catalogueUrlFor(settings),
  webTransport: transportSpecFor(settings),
});

export const BUILD_ENDPOINTS: ResolvedEndpoints = {
  contentHost: env.contentHost,
  catalogueUrl: env.catalogueUrl,
  webTransport: env.webTransport,
};

const transportSpecFor = (settings: SettingsService): string =>
  settings.get(shellKeys(settings).webTransport).trim() || env.webTransport;

export const transportFor = (settings: SettingsService, host: HostKind): Transport =>
  host === "web" ? parseTransport(transportSpecFor(settings)) : NO_TRANSPORT;

export const appIdFor = (build: string): string => {
  const channel = channelOf(build);
  if (channel === "production") return "sefer-prod";
  if (channel === "development") return "sefer-local";
  return `sefer-${channel}`;
};

let booted: ResolvedEndpoints | null = null;

export const rememberBootEndpoints = (resolved: ResolvedEndpoints): void => {
  booted ??= resolved;
};

export const bootTransport = (): Transport =>
  parseTransport(booted?.webTransport ?? env.webTransport);

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
