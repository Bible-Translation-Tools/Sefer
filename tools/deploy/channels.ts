import {
  CHANNEL_ENDPOINTS,
  WEB_TRANSPORT_SPEC,
  type Channel,
} from "../../src/core/remote/channels.ts";

export { CHANNEL_ENDPOINTS, type Channel };

export const channelEnv = (channel: Channel): Readonly<Record<string, string>> => {
  const endpoints = CHANNEL_ENDPOINTS[channel];
  return {
    VITE_SEFER_CONTENT_HOST: endpoints.contentHost,
    VITE_SEFER_CATALOGUE_URL: endpoints.catalogueUrl,
    VITE_SEFER_WEB_TRANSPORT: WEB_TRANSPORT_SPEC,
  };
};
