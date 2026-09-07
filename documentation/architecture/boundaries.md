# Framework and platform boundaries

`src/core` holds domain and application policy that must run under plain Node.

Core may use Effect and other core modules. Core policy may **not** use Node:
`node:*` bare specifiers and `@effect/platform-node*` are forbidden, because
core must run in a browser as well as under Node. A core `*.test.ts` file is
exempt — a test is Node's own program and may reach for the builtins and the
Node platform layer to build the fixtures the policy runs against.

Core may not depend on Solid (`solid-js`, `@solidjs/*`), TanStack Router
(`@tanstack/*`), Tauri (`@tauri-apps/*`), CodeMirror (`@codemirror/*`),
`isomorphic-git`, native filesystem implementations, or DOM/host globals
(`window`, `document`, `navigator`, `localStorage`, `sessionStorage`, `fetch`).
A capability core needs arrives as a core port that a host implements.

The filesystem is the shape of that rule, not an exception to it: the port is
Effect's own `FileSystem` service, which core may use because it comes from
`effect`, while every native implementation stays outside core. See
[storage](storage.md).

Core today is `boot`, `observability`, the `fileSystem` helpers, the `fixture`
seed, `source` (canonical text and its stamp) and `book` (the plain, in-memory
Book over a `FileSystem` read). See [source and book](source.md).

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
