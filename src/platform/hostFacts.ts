/**
 * The browser half of `HostFacts`: what `navigator` will say about the
 * machine, for the diagnostics header. The desktop host overrides the OS
 * fields with what `plugin-os` reports (`src/platform/tauri/hostFacts.ts`);
 * the WebView and user agent come from here on both.
 *
 * Read once, at composition. Nothing here is a guess: a field the browser
 * does not answer is `"unknown"`.
 */
import { UNKNOWN, type HostFacts } from "#core/diagnostics/header";

/** The browser or WebView and its major version, from the user agent. Order matters. */
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
    // WKWebView and WebKitGTK name the engine without a version.
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
    // A browser freezes the OS version in its user agent, so it is not
    // reported rather than reported wrong.
    osVersion: UNKNOWN,
    arch: UNKNOWN,
    webview: webviewOf(userAgent),
    userAgent,
    locale: typeof navigator === "object" ? navigator.language : UNKNOWN,
    version: UNKNOWN,
  };
};
