/// <reference types="vite/client" />

/** Injected by Vite `define` in vite.config.ts: `<short git sha>+<mode>`. */
declare const __SEFER_BUILD__: string;

interface ImportMetaEnv {
  /** Raw sink: JSONL to stderr under a Node-shaped host. */
  readonly VITE_SEFER_LOG?: string;
  /**
   * Console stream: `1` for every operation, or a comma-separated list of name
   * prefixes (`editor.mutation`, `boot,project.`). Dev builds only.
   */
  readonly VITE_SEFER_STREAM?: string;
}
