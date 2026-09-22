/**
 * Which hosts each channel is built to talk to.
 *
 * These are hostnames, not secrets — they end up inlined in a public bundle
 * either way — so they live here rather than in 1Password, where a value
 * nobody can read is a value nobody can check.
 *
 * ONE table, two consumers: `tools/deploy/web.ts` sets them for the web build,
 * and `tools/deploy/channelEnv.ts` prints them for the desktop job, which
 * cannot import TypeScript from a YAML `env:` block. The alternative was
 * writing the same hostnames twice in two files that have no way to disagree
 * out loud, which is exactly the failure `web.ts` exists to prevent for the
 * mode-to-channel pairing.
 *
 * These are DEFAULTS, not destinations. The endpoint is a preference as well as
 * a build value (`src/app/endpoints.ts`), so any build can be pointed at any
 * environment from the Network card of `/settings` — a production build can
 * look at dev WACS by typing the dev proxy's URL, and does not need a special
 * build to do it. What this table decides is only where a build points when
 * nobody has said otherwise.
 *
 * `preview` therefore points at PRODUCTION content. Preview is a release
 * channel in the Zed sense — ahead of stable, but people doing real work in
 * it — not a staging environment, so a preview user opening their own
 * translations is the ordinary case and pointing them at a copy would be the
 * surprise. `dev` is the channel that gets dev content: it is every push to
 * master, it carries the design surface and the comment panel that swallows
 * clicks, and it is the one somebody is invited to poke rather than use.
 *
 * What keeps real translations safe is not this table and never was. It is
 * Gitea auth: a push needs a token with write access to that repository. The
 * proxies still pin one upstream each, so an ENDPOINT reaches exactly the
 * content it says it does — that is a property worth keeping, and it is a
 * different property from "which build am I running".
 */

/** The three web channels, plus the two the desktop matrix builds. */
export type Channel = "production" | "preview" | "dev";

export interface ChannelEndpoints {
  /**
   * The WACS endpoint a browser build uses: the proxy, because a browser
   * cannot reach the content host directly.
   */
  readonly wacsWebUrl: string;
  /**
   * The WACS endpoint a desktop build uses: the content host itself. git2
   * speaks smart-HTTP and is not a browser origin, so no proxy is involved.
   */
  readonly wacsDesktopUrl: string;
  /**
   * What the proxy expects in `X-Requested-With`.
   *
   * One per channel, not one per application. It is a label rather than a
   * credential — it ships in this bundle — so its whole value is telling the
   * proxy's logs which build made a request, and letting one channel be
   * dropped from an allowlist without touching another. A single shared
   * identifier would throw both away for nothing.
   */
  readonly wacsAppId: string;
  /**
   * Language names, directions and the catalogue.
   *
   * TODO(2026-09-22): the two deployments of this exist — there is a dev build
   * of the Language API sitting against dev WACS — but their URLs are not
   * written down anywhere in this repository, so filling them in is somebody
   * else's one-line change. Until then every channel leaves it unset and the
   * Find Project screen shows its sample catalogue and says so, which is the
   * honest state rather than a guessed hostname.
   */
  readonly languageApiUrl?: string;
}

export const CHANNEL_ENDPOINTS: Readonly<Record<Channel, ChannelEndpoints>> = {
  production: {
    wacsWebUrl: "https://wacs-proxy.bibletranslationtools.org",
    wacsDesktopUrl: "https://content.bibletranslationtools.org",
    wacsAppId: "sefer-prod",
  },
  preview: {
    wacsWebUrl: "https://wacs-proxy.bibletranslationtools.org",
    wacsDesktopUrl: "https://content.bibletranslationtools.org",
    wacsAppId: "sefer-preview",
  },
  dev: {
    wacsWebUrl: "https://wacs-proxy.bttdev.org",
    wacsDesktopUrl: "https://content.wacsdev.org",
    wacsAppId: "sefer-dev",
  },
};

/**
 * The channel's endpoints as the variables `src/app/env.ts` reads.
 *
 * An absent value is LEFT ABSENT rather than set to an empty string: `env.ts`
 * treats blank as unset, but a variable that is present and empty reads as a
 * decision somebody made, and this one has not been made yet.
 */
export const channelEnv = (channel: Channel): Readonly<Record<string, string>> => {
  const endpoints = CHANNEL_ENDPOINTS[channel];
  return {
    VITE_SEFER_WACS_WEB_URL: endpoints.wacsWebUrl,
    VITE_SEFER_WACS_DESKTOP_URL: endpoints.wacsDesktopUrl,
    VITE_SEFER_WACS_APP_ID: endpoints.wacsAppId,
    ...(endpoints.languageApiUrl === undefined
      ? {}
      : { VITE_SEFER_LANGUAGE_API_URL: endpoints.languageApiUrl }),
  };
};
