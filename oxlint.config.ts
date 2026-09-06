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
                  "../*",
                  "../**",
                  "../../**",
                  "../../../**",
                  "@/app/**",
                  "@/platform/**",
                  "!../fileSystem/*",
                  "!../../../fixtures/**",
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
