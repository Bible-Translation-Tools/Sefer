import solidV2 from "eslint-plugin-solid/configs/v2";
import { defineConfig } from "oxlint";

export default defineConfig({
  jsPlugins: ["eslint-plugin-solid", "./tools/oxlint/anti-slop/index.ts"],
  ignorePatterns: [
    "node_modules",
    "dist",
    "src-tauri/target",
    "src-tauri/gen",
    "**/*.gen.*",
    "pnpm-lock.yaml",
  ],
  settings: solidV2.settings,
  rules: {
    ...solidV2.rules,
    /**
     * OFF, because in Solid 2 it is wrong — and it is wrong in the expensive
     * direction, where following it compiles for a while and then loses type
     * safety silently.
     *
     * The rule asks for `JSX` and `ComponentProps` from `solid-js`, which is
     * correct for Solid 1. In the release candidates this repository is on,
     * `solid-js` exports NEITHER: the `JSX` namespace lives only in
     * `@solidjs/web/types/jsx.d.ts`, and the two `ComponentProps` are
     * different types —
     *
     *     @solidjs/web  T extends Component<infer P> ? P
     *                     : T extends keyof JSX.IntrinsicElements ? …[T] : …
     *     solid-js      T extends Component<infer P> ? P : never
     *
     * so `ComponentProps<"button">` taken from `solid-js` is `never`, and
     * `class` and `onClick` quietly leave every primitive's props. Taking the
     * rule's advice across the tree produced 29 "no exported member 'JSX'"
     * errors and two prop regressions; this was tried on 2026-09-22 and
     * reverted.
     *
     * It accounted for 35 of 63 lint warnings, which is most of the noise
     * standing between here and a warning-free build. Turn it back on when
     * Solid 2 ships and the plugin knows about it.
     */
    "solid/imports": "off",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
  },
  overrides: [
    {
      files: ["src/core/**/*.{ts,tsx}"],
      rules: {
        "no-restricted-imports": [
          "error",
          {
            patterns: [
              {
                group: [
                  "solid-js",
                  "solid-js/*",
                  "@solidjs/*",
                  "@tanstack/*",
                  "@tauri-apps/*",
                  "@codemirror/*",
                  "isomorphic-git",
                  "isomorphic-git/*",
                  "@/app/**",
                  "@/platform/**",
                ],
                message:
                  "Core stays framework and host independent; depend on a core contract instead. `pnpm boundaries` is the authoritative check.",
              },
            ],
          },
        ],
        "no-restricted-globals": [
          "error",
          {
            name: "window",
            message: "Core must run in Node; take a core port instead of a DOM global.",
          },
          {
            name: "document",
            message: "Core must run in Node; take a core port instead of a DOM global.",
          },
          {
            name: "navigator",
            message: "Core must run in Node; take a core port instead of a DOM global.",
          },
          {
            name: "localStorage",
            message: "Core must run in Node; take a core port instead of a DOM global.",
          },
          {
            name: "sessionStorage",
            message: "Core must run in Node; take a core port instead of a DOM global.",
          },
          {
            name: "fetch",
            message: "Core must run in Node; take a core port instead of a host global.",
          },
        ],
      },
    },
  ],
});
