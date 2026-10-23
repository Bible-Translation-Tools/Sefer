export type Channel = "production" | "preview" | "dev";

export interface ChannelEndpoints {
  readonly contentHost: string;
  readonly catalogueUrl: string;
}

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

export const channelEnv = (channel: Channel): Readonly<Record<string, string>> => {
  const endpoints = CHANNEL_ENDPOINTS[channel];
  return {
    VITE_SEFER_CONTENT_HOST: endpoints.contentHost,
    VITE_SEFER_CATALOGUE_URL: endpoints.catalogueUrl,
    VITE_SEFER_WEB_TRANSPORT: transportSpec(),
  };
};
