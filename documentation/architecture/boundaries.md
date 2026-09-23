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

Two relative-import exceptions exist, both listed in `tools/boundaries/check.ts`:
`?raw` imports from `fixtures/` (the seeded dev project) and anything under
`@wycliffeassociates/scripture-kitchen` — the pinned Scripture Kitchen engine.
Host-neutral generated code, reached by PACKAGE NAME like any other dependency
and pinned by tag in `package.json`; nothing is vendored and there is no
second record of its identity.
Only `src/core/galley` should import its code; every other module reads the
engine through that adapter. The one other import is the Web host's
`src/platform/web/galley.ts`, which takes the engine's `.wasm` as an asset URL
(`…/web/wasm?url`) to hand the adapter — bytes to load, not code to call.

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

## Imports across a layer

Each top-level layer has one alias, declared once as `tsconfig.json` `paths`:
`#core/*`, `#app/*`, `#editor/*`, `#platform/*`, `#dev/*`. An import that
crosses from one layer into another uses it (`import { … } from
"#core/book/book"`); an import within a layer stays relative. Vite reads the
same `paths` (`resolve.tsconfigPaths` in `vite.config.ts`), so there is no
second copy to drift. Raw fixture imports (`fixtures/…?raw`) stay relative,
because the checker's raw-asset exception is written for them.

An alias is not a way around the rules: `pnpm boundaries` resolves it to the
file it names and applies the same checks as to a relative path, and the Oxlint
override lists `#app/**`, `#editor/**`, `#dev/**` and `#platform/**` for core
(a core test may still reach `#platform/node/…`, as it may by relative path).

Two checks enforce this:

- Oxlint's `src/core` override (`no-restricted-imports`, `no-restricted-globals`)
  is the fast first line inside the editor and `pnpm lint`.
- `pnpm boundaries` (`tools/boundaries/check.ts`) is authoritative. It parses
  every file under `src/core` with the TypeScript compiler API and resolves
  every specifier — `import`, `import type`, `export … from`, `import()`,
  `require()`, `import = require()`, and `import.meta.glob` — including deep
  relative paths and `tsconfig.json` path aliases. It reports file, line,
  column, and specifier, and is covered by `tools/boundaries/check.test.ts`.
