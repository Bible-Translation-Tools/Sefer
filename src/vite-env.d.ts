/// <reference types="vite/client" />

/** Injected by Vite `define` in vite.config.ts: `<short git sha>+<mode>`. */
declare const __SEFER_BUILD__: string;

/**
 * Injected by Vite `define`: the engine dependency's tag, e.g. `v0.1.4`, read
 * from `package.json` at config time. There is no second copy of it.
 */
declare const __GALLEY_TAG__: string;

/**
 * Injected by Vite `define`: whether this build carries the design surface.
 *
 * There are three builds, not two. A production build must not contain
 * `/design` at all. A dev build obviously has it. And the deployed prototype —
 * the URL a designer sends a product owner — is a PRODUCTION build that does:
 * minified, served from a worker, and it has to answer `/design`. That third
 * one is `vite build --mode design`, a CLI flag rather than a `VITE_` variable
 * on purpose, because an env file is state on somebody's machine that can
 * drift and switch this on in a real release, and a flag on a deploy job
 * cannot.
 *
 * A `define` rather than an exported constant, and that distinction is load
 * bearing. An exported `DESIGN_ENABLED` folds at its use site, so the gate
 * itself compiles away correctly — but rolldown still emitted the design
 * page's chunk, orphaned and unreachable yet shipped. A `define` is a literal
 * before any of that, which is why `/dev/fixture` has never had the problem:
 * it writes `import.meta.env.DEV` inline. `tools/verify/designBundle.ts`
 * checks the result against a real build rather than trusting this note.
 */
declare const __SEFER_DESIGN__: boolean;

interface ImportMetaEnv {
  /** Raw sink: JSONL to stderr under a Node-shaped host. */
  readonly VITE_SEFER_LOG?: string;
  /**
   * Console stream: `1` for every operation, or a comma-separated list of name
   * prefixes (`editor.mutation`, `boot,project.`). Dev builds only.
   */
  readonly VITE_SEFER_STREAM?: string;
}
