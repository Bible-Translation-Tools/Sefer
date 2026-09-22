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
 * `preview` points at DEV content deliberately. Preview is the channel people
 * are asked to go and test drive, and somebody clicking around a release
 * candidate must not be able to push at real translations. The separation is
 * not enforced here — it is enforced by each proxy deployment being pinned to
 * one upstream, so a preview build physically cannot reach production content.
 * This table only decides which door the build knocks on.
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
  /** What the proxy expects in `X-Requested-With`; a label, not a credential. */
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
    wacsAppId: "sefer-web",
  },
  preview: {
    wacsWebUrl: "https://wacs-proxy.bttdev.org",
    wacsDesktopUrl: "https://content.wacsdev.org",
    wacsAppId: "sefer-web",
  },
  dev: {
    wacsWebUrl: "https://wacs-proxy.bttdev.org",
    wacsDesktopUrl: "https://content.wacsdev.org",
    wacsAppId: "sefer-web",
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
