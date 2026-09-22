# Working in Sefer

Sefer is a local-first scripture editor whose source of truth is exact USFM text. This scaffold uses Solid 2 release-candidate packages, not React. Use pnpm.

Loadable skills live in `agents/skills/` (`.claude/skills` is a symlink to it). `design-surface` covers prototyping, the point-and-comment collector, variants and tweaks, and the designer handoff.

Read only the guidance relevant to the task:

- [Documentation index](documentation/README.md): scope, authority, and maintenance.
- [Solid development and diagnostics](documentation/architecture/solid.md): read before Solid changes or reactive debugging; includes versioned skill locations and evidence capture.
- [Testing](documentation/architecture/testing.md): coverage ownership, runner choice, cadence, and current commands.
- [Agent verification](documentation/agents/verification.md): explore the running app, capture evidence, and decide what earns a regression test.
- [Observability](documentation/architecture/observability.md): logs, spans, bounded editor evidence, and platform sinks.
- [Boundaries](documentation/architecture/boundaries.md): what `src/core` may depend on, and the checks that enforce it.
- [Storage](documentation/architecture/storage.md): the `effect/FileSystem` port, its Node and in-memory layers, atomic writes, root scoping, and the contract suite.
- [Source and Book](documentation/architecture/source.md): canonical UTF-8 text, the `SourceStamp` freshness rule, and the plain in-memory Book.
- [Application shell](documentation/architecture/shell.md): read before touching `src/app`, `src/routes`, or the design tokens; covers the one services composition, the command registry, the routes, and the single Solid/Book subscription rule.
- [The UI layer](documentation/architecture/ui.md): read before adding a screen, a component, or a colour; covers Tailwind over the semantic tokens, the primitive inventory, the dark-mode rule, and why corvu lives only inside `primitives/`.
- [Resource metadata](documentation/architecture/resources.md): the Scripture Burrito and Resource Container schemas every metadata value is decoded through, whoever read the bytes.
- [Character inventory](documentation/architecture/inventory.md): read before touching `/inventory` or the Sous pattern table; covers what "occurrences" means and why the table is not a census of the project's characters.
- [Findings](documentation/architecture/findings.md): the one `Finding` shape, the two stamps, what ProjectAnalysis holds, the filters, and the panel.
- [The landing screens](documentation/architecture/landing.md): the project list, what each import source needs per host, the Catalogue port, and where Create stops.
- [Key terms (STET)](documentation/architecture/stet.md): read before touching `/terms`; covers the frozen catalogue and its `StetCatalog` port, the committed guide fixture, how a guide reference maps onto the project, and what is still a stand-in.
- [Review](documentation/architecture/review.md): read before touching `/review`, `src/app/ui/review`, `src/core/compare`, `src/core/save` or `src/core/recovery`; covers the `CompareSource` port and why BOTH sides are pickers, the decision unit and the engine door behind it, what Apply writes and refuses, the explicit-only save model, and the working-state backup.
- [The design surface](documentation/architecture/design.md): read before touching `/design`, `src/dev/design`, `src/dev/annotate` or the `__SEFER_DESIGN__` define; covers the three build modes and why the switch is a `define`, the path boundaries, the floating annotator, and how the designer hands work over.
- [Cloud sync](documentation/architecture/sync.md): read before touching `/cloud`, `src/core/sync` or the Remote port; covers the nine states, the two clocks, the incoming plan, and why scripture text is never merged automatically.

`src/App.tsx` calls `composeApplication()` exactly once; services reach components through `useComposition()` (`src/app/CompositionContext.tsx`).

In a dev build, `/dev/fixture` runs over a seeded in-memory copy of `fixtures/small-nt/` merged over the one composition, and lists it through the `FileSystem` service. The route is generated from `src/routes/dev/fixture.tsx` in every build, but the page (`src/dev/FixturePage.tsx`) is imported only inside an `import.meta.env.DEV` branch, so production bundles none of the fixture code and answers the path with the not-found boundary.
`pnpm verify:launch [--check]` starts a dev server on a free port against that route, writes artifacts to `.verify/<runId>/`, and prints one JSON line with `url`, `runId`, `runDir`, and `pid`.

In a dev build, `globalThis.__sefer.observability` exposes `recent()`, `export()` (JSONL), `level()`, and `setLevel()`, and `globalThis.__sefer.state()` reports the boot result, the seeded fixture, and the ring depth — use them to read what the running application actually did instead of adding logging.

Check `package.json` and runner configuration for executable commands. Distinguish intended tooling from working setup, and preserve unrelated worktree changes.

## Fast commands

- `pnpm typecheck` checks TypeScript without emitting files.
- `pnpm lint` runs Oxlint over the repository.
- `pnpm format:check` verifies Oxfmt without rewriting files.
- `pnpm test:unit` runs the Node `core` Vitest project — every `src/**/*.test.ts` except `*.browser.test.*`, plus `tools/**/*.test.ts`. There is no jsdom project.
- `pnpm test:browser` runs the real Chromium Browser Mode project — today five files: the app's mount/dispose, the composition, the fixture page, the OPFS `fileSystemContract` suite, and web git. There is no end-to-end suite that drives a built app, and no Tauri WebDriver suite.
- `pnpm build` builds the shared Web frontend; `pnpm dev:tauri` starts the Tauri host.
- `pnpm boundaries` proves `src/core` imports nothing framework- or host-specific, that nothing outside `src/dev` statically imports it, and that `src/dev/annotate` imports no framework at all.
- `pnpm build:design` builds the deployed prototype — a production build that DOES carry `/design` and the design annotator. See below.
- `pnpm verify:design` runs two real builds and proves the design surface is absent from production and present in the design build.
- `pnpm design:scaffolding` lists real screens still borrowing the design panel through `globalThis.__sefer.design.register`. Informational; exits 0.
- `pnpm check` runs the ordinary local gate: typecheck, lint, formatting, boundaries, unit tests, and build. `.github/workflows/check.yml` runs the same commands, plus `pnpm test:browser` in a second job.

## The design build switch

`__SEFER_DESIGN__` is a Vite `define` set in `vite.config.ts` to
`mode === "development" || mode === "design"`. It is the ONE answer to
"does this build carry the design surface": `/design`, the floating
annotator mounted from `src/routes/__root.tsx`, and the `data-loc` JSX
stamps from `tools/vite/jsxLocation.ts`.

**It is never on in production, and there is no variable that turns it on.**
There is deliberately no `INCLUDE_DESIGNER` or other `.env` switch: an env
file is state on a machine that can drift into a release, whereas
`--mode design` is a flag on a deploy job. Comment mode swallows every event
in the capture phase, so shipping it to somebody editing scripture would be a
foot-gun.

Gate with `__SEFER_DESIGN__` directly, never through an imported constant — an
exported constant folds at its use site but still left rolldown emitting the
design page as an orphaned, shipped chunk. `documentation/architecture/design.md`
has the full account; `src/vite-env.d.ts` declares it.

Core modules stay independent of Solid, the router, Tauri, CodeMirror, DOM globals, and native filesystem implementations; `pnpm boundaries` is the authoritative check. TanStack Router owns navigation; it is not automatically the DI container. Effect supplies the boot program's typed failures and the observability and filesystem Layers; the filesystem port is `effect/FileSystem` and no host provides it yet. Isomorphic Git is present as a dependency for later integration work, but its lifecycle and filesystem adapter are not established by the scaffold.
