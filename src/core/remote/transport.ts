/**
 * How a browser reaches a content host: the Web transport.
 *
 * A content host (`https://content.bibletranslationtools.org`) is a
 * repository's IDENTITY — what the UI shows, what `.git/config` stores, what a
 * saved sign-in is filed under. A browser cannot speak git or the Gitea API to
 * it directly (no CORS), so on the Web each host has a proxy in front of it
 * that answers on the same paths. The proxy is TRANSPORT: applied to a URL at
 * the moment of the request, never stored, never shown.
 *
 * Each proxy is pinned to one upstream, which is why this is a table of pairs
 * and not a free-text proxy setting: choosing a proxy that fronts a different
 * host than the URL names would reach the wrong content. The pairs arrive from
 * the build (`VITE_SEFER_WEB_TRANSPORT`, written by `tools/deploy/channels.ts`),
 * so no hostname appears here. Desktop has no transport: git2 is not a
 * browser origin and reaches the host itself.
 */

export type Transport = ReadonlyMap<string, string>;

export const NO_TRANSPORT: Transport = new Map();

const parsed = (url: string): URL | undefined => {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
};

const originOf = (url: string): string | undefined => parsed(url)?.origin;

const rest = (url: URL): string => `${url.pathname}${url.search}${url.hash}`;

export const parseTransport = (spec: string | undefined): Transport => {
  const pairs = new Map<string, string>();
  for (const pair of (spec ?? "").split(",")) {
    const [host, proxy] = pair.split("=").map((part) => part.trim());
    const from = host === undefined ? undefined : originOf(host);
    const to = proxy === undefined ? undefined : originOf(proxy);
    if (from !== undefined && to !== undefined) pairs.set(from, to);
  }
  return pairs;
};

export const through = (transport: Transport, url: string): string => {
  const at = parsed(url);
  const proxy = at === undefined ? undefined : transport.get(at.origin);
  return proxy === undefined || at === undefined ? url : proxy + rest(at);
};

export const identityOf = (transport: Transport, url: string): string => {
  const at = parsed(url);
  if (at === undefined) return url;
  for (const [host, proxy] of transport) if (proxy === at.origin) return host + rest(at);
  return url;
};
