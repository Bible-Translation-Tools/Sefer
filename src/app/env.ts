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
  /** Gitea (WACS) base URL the Web build logs into and clones from. */
  readonly giteaWebHost: string | null;
  /** Gitea base URL the desktop build uses; may differ from the Web host. */
  readonly giteaDesktopHost: string | null;
  /** CORS proxy in front of Gitea's smart-HTTP for isomorphic-git on the Web. */
  readonly gitCorsProxyUrl: string | null;
  /** Value the proxy expects in `X-Requested-With`; null sends no header. */
  readonly gitProxyRequestedWith: string | null;
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
  giteaWebHost: read(import.meta.env.VITE_SEFER_GITEA_WEB_HOST),
  giteaDesktopHost: read(import.meta.env.VITE_SEFER_GITEA_DESKTOP_HOST),
  gitCorsProxyUrl: read(import.meta.env.VITE_SEFER_GIT_CORS_PROXY_URL),
  gitProxyRequestedWith: read(import.meta.env.VITE_SEFER_GIT_PROXY_X_REQUESTED_WITH),
  languageApiUrl: read(import.meta.env.VITE_SEFER_LANGUAGE_API_URL),
  otlpUrl: read(import.meta.env.VITE_SEFER_OTLP_URL),
  otlpMetrics: import.meta.env.VITE_SEFER_OTLP_METRICS === "1",
};

/** The Gitea host for the host we are running on. */
export const giteaHostFor = (host: "web" | "tauri"): string | null =>
  host === "tauri" ? env.giteaDesktopHost : env.giteaWebHost;
