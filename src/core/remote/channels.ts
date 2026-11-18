/**
 * The servers each deployed channel talks to: the WACS content host and the
 * language catalogue. The deploy tools bake one channel's pair into a build
 * (`tools/deploy/channels.ts`); Settings → Network flips a running build
 * between them without a rebuild.
 */
export type Channel = "production" | "preview" | "dev";

export interface ChannelEndpoints {
  readonly contentHost: string;
  readonly catalogueUrl: string;
}

const PRODUCTION: ChannelEndpoints = {
  contentHost: "https://content.bibletranslationtools.org",
  catalogueUrl: "https://api.bibleineverylanguage.org/v1/graphql",
};

export const CHANNEL_ENDPOINTS: Readonly<Record<Channel, ChannelEndpoints>> = {
  production: PRODUCTION,
  preview: PRODUCTION,
  dev: {
    contentHost: "https://content.wacsdev.org",
    catalogueUrl: "https://api-biel-dev.walink.org/v1/graphql",
  },
};

/**
 * How a browser reaches each content host: through its CORS proxy. One spec
 * serves every channel, so a build can be flipped between them.
 */
const WEB_TRANSPORT: Readonly<Record<string, string>> = {
  "https://content.bibletranslationtools.org": "https://wacs-proxy.bibletranslationtools.org",
  "https://content.wacsdev.org": "https://wacs-proxy.bttdev.org",
};

/** `host=proxy` pairs, comma separated, as `VITE_SEFER_WEB_TRANSPORT` and the setting read them. */
export const WEB_TRANSPORT_SPEC: string = Object.entries(WEB_TRANSPORT)
  .map(([host, proxy]) => `${host}=${proxy}`)
  .join(",");
