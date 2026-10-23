export const cleanUrl = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/u, "") : null;
};

export interface SeferEnv {
  readonly updaterHost: string | null;
  readonly contentHost: string | null;
  readonly webTransport: string;
  readonly catalogueUrl: string | null;
  readonly otlpUrl: string | null;
  readonly otlpMetrics: boolean;
  readonly log: string;
  readonly stream: string;
}

export const env: SeferEnv = {
  updaterHost: cleanUrl(import.meta.env.VITE_SEFER_UPDATER_HOST),
  contentHost: cleanUrl(import.meta.env.VITE_SEFER_CONTENT_HOST),
  webTransport: (import.meta.env.VITE_SEFER_WEB_TRANSPORT ?? "").trim(),
  catalogueUrl: cleanUrl(import.meta.env.VITE_SEFER_CATALOGUE_URL),
  otlpUrl: cleanUrl(import.meta.env.VITE_SEFER_OTLP_URL),
  otlpMetrics: import.meta.env.VITE_SEFER_OTLP_METRICS === "1",
  log: (import.meta.env.VITE_SEFER_LOG ?? "").trim(),
  stream: (import.meta.env.VITE_SEFER_STREAM ?? "").trim(),
};
