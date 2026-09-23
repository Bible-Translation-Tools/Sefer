# Working in Sefer

Sefer is a local-first scripture editor whose source of truth is exact USFM text. It uses Solid 2 release-candidate packages, not React. Use pnpm.

Loadable skills live in `agents/skills/` (`.claude/skills` is a symlink to it):

- [Release channels](agents/skills/release-channels/SKILL.md): read before deploying, tagging, or answering "what does a push to master do"; the dev/preview/production matrix, the tag format, the exact commands, and why master deploys `dev`.
- [The design surface](agents/skills/design-surface/SKILL.md): read before design work; prototyping on `/design`, the point-and-comment collector, variants and tweaks, and how a designer's change graduates into the real screens.

Read only the guidance relevant to the task:

- [Documentation index](documentation/README.md): the full index of every chapter, plus scope, authority, and maintenance. The list below is only the chapters agents reach for most.
- [Services](documentation/services.md): one page per service, at a glance — what it owns, where it lives, and its known gaps.
- [Solid development and diagnostics](documentation/architecture/solid.md): read before Solid changes or reactive debugging; includes versioned skill locations and evidence capture.
- [Testing](documentation/architecture/testing.md): coverage ownership, runner choice, cadence, and current commands.
- [Agent verification](documentation/agents/verification.md): explore the running app, capture evidence, and decide what earns a regression test.
- [Lint results](documentation/lint-results.md): read before adding a suppression comment, changing a gate or a linter's config, or when a gate reports something new; what is gated where, what is deliberately left, and the process for keeping that record true.
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

Under the dev server (`pnpm dev`, where `import.meta.env.DEV` is true — not `pnpm build:dev`), `/dev/fixture` runs over a seeded in-memory copy of `fixtures/small-nt/` merged over the one composition, and lists it through the `FileSystem` service. The route is generated from `src/routes/_app/dev/fixture.tsx` in every build, but the page (`src/dev/FixturePage.tsx`) is imported only inside an `import.meta.env.DEV` branch, so production bundles none of the fixture code and answers the path with the not-found boundary.
`pnpm verify:launch [--check]` starts a dev server on a free port against that route, writes artifacts to `.verify/<runId>/`, and prints one JSON line with `url`, `runId`, `runDir`, and `pid`.

Under the dev server, `globalThis.__sefer.observability` exposes `traces.recent()` and `traces.print()` (assembled operations), `logs.recent()` (loose events), `export()` (JSONL), `level()`, `setLevel()`, and `stream()` (console streaming), and `globalThis.__sefer.state()` reports the boot result, the seeded fixture, and the ring depth — use them to read what the running application actually did instead of adding logging.

Check `package.json` and runner configuration for executable commands. Distinguish intended tooling from working setup, and preserve unrelated worktree changes.

## Fast commands

- `pnpm typecheck` checks TypeScript without emitting files.
- `pnpm lint` runs Oxlint over the repository.
- `pnpm format:check` verifies Oxfmt without rewriting files.
- `pnpm test:unit` runs the Node `core` Vitest project — every `src/**/*.test.ts` except `*.browser.test.*`, plus `tools/**/*.test.ts`. There is no jsdom project.
- `pnpm test:browser` runs the real Chromium Browser Mode project — today four files: the composition's dev observability surface, the fixture page, the OPFS `fileSystemContract` suite, and web git. It is for real browser APIs at module level; the built artifact belongs to `pnpm test:e2e`.
- `pnpm test:e2e` builds the app, serves `dist/client` through `vite preview`, and drives it with Playwright (`e2e/`). Three smoke assertions: it mounts, a deep link resolves through the SPA fallback, and a production build carries no design surface. Deliberately says nothing about how a screen looks — behaviour is still moving, and a suite that breaks on every redesign is one people delete. There is still no Tauri WebDriver suite.
- `pnpm build` builds the shared Web frontend; `pnpm dev:tauri` starts the Tauri host.
- `pnpm boundaries` proves `src/core` imports nothing framework- or host-specific, that nothing outside `src/dev` statically imports `src/dev`, and that `src/dev/annotate` imports no framework at all.
- `pnpm build:dev` builds the `dev` channel — a production build that DOES carry `/design`, the comment panel and `?fixture=1`. See below.
- `pnpm deploy:web <dev|preview|production>` builds for that channel and ships it; `--dry` builds and prints the wrangler command without shipping. The mode-to-channel pairing lives in `tools/deploy/web.ts`, so CI and a laptop cannot disagree.
- `pnpm branch:preview [branch]` gives one BRANCH its own URL without deploying anything: it builds `--mode dev` and uploads a Cloudflare *version* of the `sefer-web-dev` Worker under a per-branch alias, so `sefer-dev.bttdev.org` is untouched. `check.yml` runs it on every push to a non-master branch. Two unrelated things are called "preview" here — **ChannelPreview** is the `preview` channel, **CloudflarePreview** is this — so always say which; [glossary](documentation/glossary.md), "Deployment names".
- `pnpm deploy:updater <preview|production>` deploys the Tauri updater worker in `workers/sefer-updater` and refreshes its GitHub token. Separate deployable, separate hostname; there is no `dev` because dev is web-only. See `workers/README.md`.
- `pnpm lint:release` adds the rules that only have to hold at release — today, no leftover `globalThis.__sefer.design` scaffolding. Run before `preview` and `production`, never before `dev`.
- `pnpm verify:design` runs two real builds and proves the design surface is absent from production and present in the design build.
- `pnpm design:scaffolding` lists real screens still borrowing the design panel through `globalThis.__sefer.design.register`. Informational; exits 0.
- `pnpm deadcode` fails on an unused file, export, type or dependency, or an import cycle; `release.yml`'s `verify` runs it before every deploy (not `pnpm check`, so a branch may carry a half-wired file). `pnpm exec fallow dead-code | dupes | health` is the full, advisory report; `.fallowrc.jsonc` holds the entries and the dependencies it cannot see.
- `pnpm lint:results` regenerates the inventory half of `documentation/lint-results.md`; the pre-commit hook runs it for you.
- `pnpm check` runs the ordinary local gate: typecheck, lint, formatting, boundaries, unit tests, and build. `.github/workflows/check.yml` runs it on every branch except master, plus `pnpm test:browser` in a second job. Master's gate is `release.yml`'s `verify` job: `pnpm check`, `pnpm deadcode` and `pnpm test:browser`; preview and production add `pnpm test:e2e` and `pnpm verify:design`.

## Channels

`dev` is every push to master — web only, `--mode dev`, the only deployed thing carrying `/design`, the comment panel and `?fixture=1`. `preview` is a PROMOTION (a dispatch or a `v*-N` tag such as `v0.3.0-1`; `-rc.1` breaks Tauri's MSI bundler), with the full test suite and the full desktop matrix. `production` is a `v*` tag. Desktop has two channels, not three, because a desktop build costs twenty minutes and a web build costs one.

Master deploying the least-stable channel reads oddly and is deliberate: the alternative is a long-lived `dev` branch, which means a merge train and divergence, and the person most often working here does not use git. One trunk keeps history linear, and it keeps `dev` and `preview` the same commit built two ways — so a difference between them can only ever be the design surface, never drift.

Commands, tag format and what is not armed yet: [release channels](agents/skills/release-channels/SKILL.md).

## The design build switch

`__SEFER_DESIGN__` is a Vite `define` (`vite.config.ts`: `mode === "development" || mode === "dev"`) and the ONE answer to "does this build carry the design surface" — `/design`, the floating annotator, and the `data-loc` JSX stamps. **It is never on in production, and there is no variable that turns it on**: no `.env` switch, because an env file can drift into a release and `--mode dev` is a flag on a deploy job. Gate with `__SEFER_DESIGN__` directly, never through an imported constant. [The design surface](documentation/architecture/design.md) has the full account.

Core modules stay independent of Solid, the router, Tauri, CodeMirror, DOM globals, and native filesystem implementations; `pnpm boundaries` is the authoritative check. TanStack Router owns navigation; it is not automatically the DI container. Effect supplies the boot program's typed failures and the observability and filesystem Layers; the filesystem port is `effect/FileSystem`, provided by OPFS on the Web and by the Tauri filesystem on desktop (`src/app/services.ts`). The Git port runs on isomorphic-git on the Web (`src/platform/web/git.ts`) and on git2 on desktop.
