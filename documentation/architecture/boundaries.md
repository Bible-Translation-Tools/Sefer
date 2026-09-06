# Framework and platform boundaries

`src/core` holds domain and application policy that must run under plain Node.

Core may use Effect, Node builtins, and other core modules.

Core may not depend on Solid (`solid-js`, `@solidjs/*`), TanStack Router
(`@tanstack/*`), Tauri (`@tauri-apps/*`), CodeMirror (`@codemirror/*`),
`isomorphic-git`, native filesystem implementations, or DOM/host globals
(`window`, `document`, `navigator`, `localStorage`, `sessionStorage`, `fetch`).
A capability core needs arrives as a core port that a host implements.

The filesystem is the shape of that rule, not an exception to it: the port is
Effect's own `FileSystem` service, which core may use because it comes from
`effect`, while every native implementation stays outside core. See
[storage](storage.md).

CodeMirror belongs to the editor layer and will live in `src/editor/` when that
layer exists. It is not a core dependency at any depth.

`src/app` composes core policy with the shared Solid UI; `src/platform` detects
and supplies host capabilities. Both may depend inward on core contracts. Core
never depends outward.

Two checks enforce this:

- Oxlint's `src/core` override (`no-restricted-imports`, `no-restricted-globals`)
  is the fast first line inside the editor and `pnpm lint`.
- `pnpm boundaries` (`tools/boundaries/check.ts`) is authoritative. It parses
  every file under `src/core` with the TypeScript compiler API and resolves
  every specifier — `import`, `import type`, `export … from`, `import()`,
  `require()`, `import = require()`, and `import.meta.glob` — including deep
  relative paths and `tsconfig.json` path aliases. It reports file, line,
  column, and specifier, and is covered by `tools/boundaries/check.test.ts`.
