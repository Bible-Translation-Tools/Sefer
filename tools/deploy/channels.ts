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
 * These are DEFAULTS, not destinations. Each is a preference as well as a
 * build value (`src/app/endpoints.ts`), so any build can be pointed at any
 * environment from the Network card of `/settings` (under Advanced) — a
 * production build can look at dev WACS by typing the dev content host, and
 * does not need a special build to do it. What this table decides is only
 * where a build points when nobody has said otherwise.
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
 * proxies still pin one upstream each, so a content host is reached exactly
 * where it says it is — that is a property worth keeping, and it is a
 * different property from "which build am I running".
 */

/** The three web channels, plus the two the desktop matrix builds. */
export type Channel = "production" | "preview" | "dev";

export interface ChannelEndpoints {
  /**
   * The content host: the Gitea a project comes from and publishes to. The
   * same on the Web and on desktop — it is an identity; only how a browser
   * reaches it differs, and that is `WEB_TRANSPORT`.
   */
  readonly contentHost: string;
  /**
   * The catalogue: the Language API's GraphQL endpoint. Each row carries its
   * own git URL, so a catalogue may list repositories on hosts other than
   * `contentHost` — the dev one lists production repositories too — and
   * `WEB_TRANSPORT` covers every host either catalogue names.
   */
  readonly catalogueUrl: string;
}

/**
 * How a browser reaches each content host: the proxy in front of it, which
 * answers on Gitea's own paths. Infrastructure, not a channel choice — each
 * proxy is pinned to one upstream — so it is one table every channel ships,
 * which is what lets a dev build download a production repository its
 * catalogue lists. Written as `host=proxy` pairs, as `VITE_SEFER_WEB_TRANSPORT`
 * carries them (`src/core/remote/transport.ts` reads it).
 */
const WEB_TRANSPORT: Readonly<Record<string, string>> = {
  "https://content.bibletranslationtools.org": "https://wacs-proxy.bibletranslationtools.org",
  "https://content.wacsdev.org": "https://wacs-proxy.bttdev.org",
};

const transportSpec = (): string =>
  Object.entries(WEB_TRANSPORT)
    .map(([host, proxy]) => `${host}=${proxy}`)
    .join(",");

export const CHANNEL_ENDPOINTS: Readonly<Record<Channel, ChannelEndpoints>> = {
  production: {
    contentHost: "https://content.bibletranslationtools.org",
    catalogueUrl: "https://api.bibleineverylanguage.org/v1/graphql",
  },
  preview: {
    contentHost: "https://content.bibletranslationtools.org",
    catalogueUrl: "https://api.bibleineverylanguage.org/v1/graphql",
  },
  dev: {
    contentHost: "https://content.wacsdev.org",
    catalogueUrl: "https://api-biel-dev.walink.org/v1/graphql",
  },
};

/**
 * The channel's endpoints as the variables `src/app/env.ts` reads.
 *
 * The proxy app id is not among them: `src/app/endpoints.ts` derives it
 * from the channel the build already names.
 */
export const channelEnv = (channel: Channel): Readonly<Record<string, string>> => {
  const endpoints = CHANNEL_ENDPOINTS[channel];
  return {
    VITE_SEFER_CONTENT_HOST: endpoints.contentHost,
    VITE_SEFER_CATALOGUE_URL: endpoints.catalogueUrl,
    VITE_SEFER_WEB_TRANSPORT: transportSpec(),
  };
};
