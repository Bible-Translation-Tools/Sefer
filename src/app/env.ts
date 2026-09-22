// env.ts
//
// Every build-time URL Sefer talks to, read in exactly one place. Vite inlines
// `import.meta.env.VITE_*` at build, so the release workflow sets these per
// channel (stable / nightly) and the code never carries a hostname. An unset
// value is `null`, and each consumer degrades visibly (a disabled panel, a
// "not configured for this build" message) instead of guessing a host.
//
// Names are SEFER-prefixed so they cannot collide with the v1 app's variables
// when both are built on one machine. documentation/architecture/configuration.md
// lists them with notes.

const read = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/u, "") : null;
};

export interface SeferEnv {
  /** Updater worker base, e.g. https://updater.sefer.example.org; `/{{target}}/{{current_version}}` is appended by the plugin. */
  readonly updaterHost: string | null;
  /**
   * The WACS endpoint the Web build talks to — ONE URL, for both git transfers
   * and the Gitea API.
   *
   * It is either a Gitea instance directly, where nothing stands in front of
   * it, or the browser proxy where something does. The proxy answers on the
   * same paths Gitea does, so this build cannot tell the two apart and does
   * not need to: whichever it is, the endpoint is the base of every URL.
   *
   * That is why there is no second "which upstream should the proxy use"
   * setting. Each proxy deployment is pinned to one content host, so choosing
   * the endpoint already chose the content — and a preview build pointed at
   * the dev proxy cannot reach production content however it is configured.
   */
  readonly wacsWebUrl: string | null;
  /**
   * The same for the desktop build, which needs no proxy: git2 speaks
   * smart-HTTP itself and is not a browser origin, so this is normally the
   * Gitea host.
   */
  readonly wacsDesktopUrl: string | null;
  /**
   * What the proxy expects in `X-Requested-With`; null sends no header.
   *
   * A label rather than a credential — it ships in this bundle, so anyone can
   * read it. The gate that matters is server-side, in the proxy's own
   * allowlist; this only says which application is calling.
   */
  readonly wacsAppId: string | null;
  /** Language API for language names and directions in the shell. */
  readonly languageApiUrl: string | null;
  /** Dev-only OTLP endpoint; see composition.ts. */
  readonly otlpUrl: string | null;
  /**
   * Dev-only: send OTLP METRICS as well as traces and logs.
   *
   * Off by default, and that is the fix rather than the default. A collector
   * that takes traces and logs and not metrics (motel, which is what we
   * develop against) answered every metrics interval with `net::ERR_FAILED`,
   * so a build that had asked for tracing got a console full of a thing it had
   * not asked for. Set `VITE_SEFER_OTLP_METRICS=1` when the collector wants
   * them.
   */
  readonly otlpMetrics: boolean;
}

export const env: SeferEnv = {
  updaterHost: read(import.meta.env.VITE_SEFER_UPDATER_HOST),
  wacsWebUrl: read(import.meta.env.VITE_SEFER_WACS_WEB_URL),
  wacsDesktopUrl: read(import.meta.env.VITE_SEFER_WACS_DESKTOP_URL),
  wacsAppId: read(import.meta.env.VITE_SEFER_WACS_APP_ID),
  languageApiUrl: read(import.meta.env.VITE_SEFER_LANGUAGE_API_URL),
  otlpUrl: read(import.meta.env.VITE_SEFER_OTLP_URL),
  otlpMetrics: import.meta.env.VITE_SEFER_OTLP_METRICS === "1",
};

/** The WACS endpoint for the host we are running on. */
export const wacsUrlFor = (host: "web" | "tauri"): string | null =>
  host === "tauri" ? env.wacsDesktopUrl : env.wacsWebUrl;
