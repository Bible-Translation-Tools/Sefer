import { UNKNOWN, type HostFacts } from "#core/diagnostics/header";

const webviewOf = (userAgent: string): string => {
  const found = (label: string, pattern: RegExp): string | undefined => {
    const hit = pattern.exec(userAgent);
    return hit?.[1] === undefined ? undefined : `${label} ${hit[1]}`;
  };
  return (
    found("Edge/WebView2", /\bEdg\/(\d+(?:\.\d+)?)/u) ??
    found("Firefox", /\bFirefox\/(\d+(?:\.\d+)?)/u) ??
    found("Chrome", /\b(?:Headless)?Chrome\/(\d+(?:\.\d+)?)/u) ??
    found("Safari", /\bVersion\/(\d+(?:\.\d+)?).*Safari/u) ??
    (/AppleWebKit\//u.test(userAgent) ? "WebKit" : UNKNOWN)
  );
};

const osOf = (userAgent: string): string => {
  if (/Windows/u.test(userAgent)) return "windows";
  if (/Mac OS X|Macintosh/u.test(userAgent)) return "macos";
  if (/Android/u.test(userAgent)) return "android";
  if (/iPhone|iPad/u.test(userAgent)) return "ios";
  if (/Linux/u.test(userAgent)) return "linux";
  return UNKNOWN;
};

export const browserFacts = (host: string): HostFacts => {
  const userAgent = typeof navigator === "object" ? navigator.userAgent : UNKNOWN;
  return {
    host,
    os: osOf(userAgent),
    osVersion: UNKNOWN,
    arch: UNKNOWN,
    webview: webviewOf(userAgent),
    userAgent,
    locale: typeof navigator === "object" ? navigator.language : UNKNOWN,
    version: UNKNOWN,
  };
};
