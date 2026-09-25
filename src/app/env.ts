// env.ts
//
// Every build-time `VITE_SEFER_*` value, read in exactly one place: the URLs
// Sefer talks to and the dev-only telemetry switches. Vite inlines
// `import.meta.env.VITE_*` at build, so the release workflow sets these per
// channel (dev / preview / production) and the code never carries a hostname. An unset
// value is `null`, and each consumer degrades visibly (a disabled panel, a
// "not configured for this build" message) instead of guessing a host.
//
// Names are SEFER-prefixed so they cannot collide with the v1 app's variables
// when both are built on one machine. documentation/architecture/configuration.md
// lists them with notes.

/** Trailing slashes off, and blank treated as absent. */
export const cleanUrl = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.replace(/\/+$/u, "") : null;
};

export interface SeferEnv {
  /** Updater worker base, e.g. https://updater.sefer.example.org; `/{{target}}/{{current_version}}` is appended by the plugin. */
  readonly updaterHost: string | null;
  /**
   * The content host: the Gitea a project comes from and publishes to, WITH
   * its scheme. It is the IDENTITY — what the UI prints, what `.git/config`
   * stores, what a sign-in is filed under — on the Web and on desktop alike.
   * Never a proxy: how a browser reaches it is `webTransport`.
   */
  readonly contentHost: string | null;
  /**
   * `host=proxy,host=proxy`: how a browser reaches each content host
   * (`src/core/remote/transport.ts`). Applied at request time on the Web
   * only, never stored or shown. Every pair is listed, not only this build's
   * host, because a catalogue lists repositories on more than one.
   */
  readonly webTransport: string;
  /**
   * The catalogue: the Language API's GraphQL endpoint, which lists the
   * repositories this app can open and where each one's git URL is.
   */
  readonly catalogueUrl: string | null;
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
  /** Non-empty asks for the raw JSONL sink on stderr under Node; see `hostSink`. */
  readonly log: string;
  /** Dev-only console stream: `1`, or comma-separated prefixes; see `consoleStream`. */
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
