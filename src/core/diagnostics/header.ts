export const DIAGNOSTICS_SCHEMA = 1;

export const UNKNOWN = "unknown" as const;

export interface HostFacts {
  readonly host: string;
  readonly os: string;
  readonly osVersion: string;
  readonly arch: string;
  readonly webview: string;
  readonly userAgent: string;
  readonly locale: string;
  readonly version: string;
}

export interface BuildFacts {
  readonly build: string;
  readonly channel: string;
  readonly engine: string;
}

export interface SessionHeader extends HostFacts, BuildFacts {
  readonly schema: typeof DIAGNOSTICS_SCHEMA;
  readonly kind: "sefer.session";
  readonly session: string;
  /** Epoch ms. */
  readonly started: number;
  readonly endpoints: Readonly<Record<string, { readonly url: string; readonly edited: boolean }>>;
}

export const channelOf = (build: string): string => {
  const at = build.lastIndexOf("+");
  return at < 0 ? UNKNOWN : build.slice(at + 1);
};
