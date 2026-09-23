import solidV2 from "eslint-plugin-solid/configs/v2";
import { defineConfig } from "oxlint";

// What `src/core` may not import. The layer aliases are tsconfig `paths`
// (`#app/*` …); `pnpm boundaries` resolves them and is the authoritative check.
const CORE_FORBIDDEN = [
  "solid-js",
  "solid-js/*",
  "@solidjs/*",
  "@tanstack/*",
  "@tauri-apps/*",
  "@codemirror/*",
  "isomorphic-git",
  "isomorphic-git/*",
  "#app/**",
  "#dev/**",
  "#editor/**",
];
const CORE_MESSAGE =
  "Core stays framework and host independent; depend on a core contract instead. `pnpm boundaries` is the authoritative check.";

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
                group: [...CORE_FORBIDDEN, "#platform/**"],
                message: CORE_MESSAGE,
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
    {
      // A core test is Node's own program and may build its fixtures with the
      // Node platform layers (`#platform/node/…`) — the same exemption
      // `pnpm boundaries` gives it. Everything else stays forbidden.
      files: ["src/core/**/*.test.ts"],
      rules: {
        "no-restricted-imports": [
          "error",
          { patterns: [{ group: CORE_FORBIDDEN, message: CORE_MESSAGE }] },
        ],
      },
    },
  ],
});
