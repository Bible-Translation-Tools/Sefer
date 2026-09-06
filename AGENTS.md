# Working in Sefer

Sefer is a local-first scripture editor whose source of truth is exact USFM text. This scaffold uses Solid 2 release-candidate packages, not React. Use pnpm.

Read only the guidance relevant to the task:

- [Documentation index](documentation/README.md): scope, authority, and maintenance.
- [Solid development and diagnostics](documentation/architecture/solid.md): read before Solid changes or reactive debugging; includes versioned skill locations and evidence capture.
- [Testing](documentation/architecture/testing.md): coverage ownership, runner choice, cadence, and current commands.
- [Agent verification](documentation/agents/verification.md): explore the running app, capture evidence, and decide what earns a regression test.
- [Observability](documentation/architecture/observability.md): logs, spans, bounded editor evidence, and platform sinks.
- [Boundaries](documentation/architecture/boundaries.md): what `src/core` may depend on, and the checks that enforce it.
- [Storage](documentation/architecture/storage.md): the `effect/FileSystem` port, its Node and in-memory layers, atomic writes, root scoping, and the contract suite.

In a dev build, `globalThis.__sefer.observability` exposes `recent()`, `export()` (JSONL), `level()`, and `setLevel()` — use it to read what the running application actually did instead of adding logging.

Check `package.json` and runner configuration for executable commands. Distinguish intended tooling from working setup, and preserve unrelated worktree changes.

## Fast commands

- `pnpm typecheck` checks TypeScript without emitting files.
- `pnpm lint` runs Oxlint over the repository.
- `pnpm format:check` verifies Oxfmt without rewriting files.
- `pnpm test:unit` runs the Node `core` Vitest project — every `src/**/*.test.ts` except `*.browser.test.*`, plus `tools/**/*.test.ts`. There is no jsdom project.
- `pnpm test:browser` runs the real Chromium Browser Mode project; today that is one mount/dispose test.
- `pnpm build` builds the shared Web frontend; `pnpm dev:tauri` starts the Tauri host.
- `pnpm boundaries` proves `src/core` imports nothing framework- or host-specific.
- `pnpm check` runs the ordinary local gate: typecheck, lint, formatting, boundaries, unit tests, and build. `.github/workflows/check.yml` runs the same commands, plus `pnpm test:browser` in a second job.

Core modules stay independent of Solid, the router, Tauri, CodeMirror, DOM globals, and native filesystem implementations; `pnpm boundaries` is the authoritative check. TanStack Router owns navigation; it is not automatically the DI container. Effect supplies the boot program's typed failures and the observability and filesystem Layers; the filesystem port is `effect/FileSystem` and no host provides it yet. Isomorphic Git is present as a dependency for later integration work, but its lifecycle and filesystem adapter are not established by the scaffold.
