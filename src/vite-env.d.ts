/// <reference types="vite/client" />

/** Injected by Vite `define` in vite.config.ts: `<short git sha>+<mode>`. */
declare const __SEFER_BUILD__: string;

/**
 * Injected by Vite `define`: the engine dependency's tag, e.g. `v0.1.4`, read
 * from `package.json` at config time. There is no second copy of it.
 */
declare const __GALLEY_TAG__: string;

interface ImportMetaEnv {
  /** Raw sink: JSONL to stderr under a Node-shaped host. */
  readonly VITE_SEFER_LOG?: string;
  /**
   * Console stream: `1` for every operation, or a comma-separated list of name
   * prefixes (`editor.mutation`, `boot,project.`). Dev builds only.
   */
  readonly VITE_SEFER_STREAM?: string;
}
