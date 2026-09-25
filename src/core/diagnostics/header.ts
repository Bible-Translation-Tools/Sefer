/**
 * What every line of one session has in common, written once at the top of
 * each log part and of every export.
 *
 * The facts a person helping needs before they read a single event: which
 * build, on which host, on which OS and engine, since when. A fact the host
 * cannot answer is `"unknown"`, never a guess — a wrong WebView version is
 * worse than none, because someone will believe it.
 *
 * `schema` is the version of this shape and of the line format beneath it. A
 * reader that finds a number it does not know should say so rather than read
 * on.
 */
export const DIAGNOSTICS_SCHEMA = 1;

export const UNKNOWN = "unknown" as const;

/** Where this build and its machine stand. Plain strings: it is read by people and by `jq`. */
export interface HostFacts {
  /** `web` or `tauri`. */
  readonly host: string;
  /** The OS family (`macos`, `windows`, `linux`, …) as the host reports it. */
  readonly os: string;
  readonly osVersion: string;
  readonly arch: string;
  /** The browser, or the desktop WebView, with its version where the host says. */
  readonly webview: string;
  readonly userAgent: string;
  readonly locale: string;
  /**
   * The installed application's version, from the desktop bundle. A Web
   * build has none — its identity is `build` — so it is `"unknown"` there.
   */
  readonly version: string;
}

/** What the build was, as Vite stamped it. */
export interface BuildFacts {
  /** `<short sha>+<mode>`, `__SEFER_BUILD__`. */
  readonly build: string;
  /** `dev`, `preview`, `production`, or `development` under the dev server. */
  readonly channel: string;
  /** The Galley engine tag. */
  readonly engine: string;
}

export interface SessionHeader extends HostFacts, BuildFacts {
  readonly schema: typeof DIAGNOSTICS_SCHEMA;
  readonly kind: "sefer.session";
  readonly session: string;
  /** Epoch ms. */
  readonly started: number;
  /**
   * The endpoints this build talks to. The `VITE_SEFER_*` ones ship in the
   * public bundle, so they are not secret; a user-edited one is included too,
   * flagged, because "which server was it talking to" is the first question.
   */
  readonly endpoints: Readonly<Record<string, { readonly url: string; readonly edited: boolean }>>;
}

/** The mode half of `__SEFER_BUILD__` (`<sha>+<mode>`), which is the channel. */
export const channelOf = (build: string): string => {
  const at = build.lastIndexOf("+");
  return at < 0 ? UNKNOWN : build.slice(at + 1);
};
