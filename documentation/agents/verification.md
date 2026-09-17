# Agent verification

Status: agreed workflow direction. This is not yet an executable app-specific skill: exact launch isolation, readiness checks, and desktop driving recipes must be proved as the application takes shape.

## What exists now

Status: this section describes code that exists.

- **The dev fixture route** is `/dev/fixture`, usable only under the dev server. It is an ordinary generated file route — `src/routes/dev/fixture.tsx`, in `src/routeTree.gen.ts` like any other — but a thin shell: its `beforeLoad` throws `notFound()` when `!import.meta.env.DEV`, and its component is a `lazyRouteComponent` whose loader `import()`s the page only inside an `import.meta.env.DEV` branch. `import.meta.env.DEV` is a build-time constant, so a production build drops that branch and never bundles the page; production answers `/dev/fixture` through the root not-found boundary. The page itself is `src/dev/FixturePage.tsx` — not under `src/routes/`, so it is never a route file. After `pnpm build`, `grep -r small-nt dist/`, `grep -r usfm dist/`, `grep -r __sefer dist/`, and `grep -r FixturePage dist/` all come back empty; the literal `/dev/fixture` path string does appear, because the route is registered in every build.
- **What the page does.** It takes the one application composition from `useComposition()` and runs its listing Effect over `Layer.merge(composition.layer, FixtureFileSystemLive)` — the running application's own services with one addition, not a second boot — and renders the boot result, then every file of the `small-nt` project read back *through* the `FileSystem` service with its byte length. `reset` reseeds a fresh in-memory Layer; `?keep=1` keeps the instance already seeded. The seeded project is in-memory and page-scoped: it lives in the Layer instance for the life of the page and a reload starts from the same bytes. The route emits one `fixture` `ready` note carrying `small-nt: <n> files`.
- **The fixture data** is `fixtures/small-nt/` — four real ULB books plus one deliberately malformed file — vendored and described in `fixtures/README.md`. `src/core/fixture/smallNt.ts` imports them with Vite `?raw` and exports `FixtureFileSystemLive`, the in-memory FileSystem Layer seeded under `/small-nt`.
- **Dev surfaces on `globalThis.__sefer`**, in dev builds only: `observability` (`recent()`, `export()`, `level()`, `setLevel()`) and, once the fixture route has seeded, `state()` returning `{ boot, fixture: { project, files, seededAt }, observability }`, where `files` is `{ path, bytes }` per file and `observability` is the number of events currently in the ring.
- **The launch helper** is `pnpm verify:launch [--check]` (`tools/verify/launch.ts`, Node built-ins only). It picks a free port, creates `.verify/<runId>/` (gitignored), starts `vite --port <p> --strictPort` with `SEFER_LOG=1` and `VITE_SEFER_LOG=1`, tees the child's stderr into `<runDir>/observability.jsonl` (stdout goes to `<runDir>/server.log`), polls `http://localhost:<p>/dev/fixture` with an `accept: text/html` header until it answers 200 or 60 s pass, and prints exactly one JSON line to stdout:

```json
{"url":"http://localhost:60634/dev/fixture","runId":"2026-09-06T21-52-51-542Z-9fdaca8a","runDir":"/…/Sefer/.verify/2026-09-06T21-52-51-542Z-9fdaca8a","pid":9032}
```

  Without `--check` it stays up until SIGINT or SIGTERM, then kills the dev server and exits 0. With `--check` it exits as soon as the route is ready — readiness is around 1.7 s on a warm cache.

  The `accept: text/html` header is not optional: `@solidjs/vite-plugin` runs in client mode with `appType: "custom"`, and its dev page middleware only answers requests that ask for HTML. A plain `curl` or `fetch` with `accept: */*` gets `Cannot GET /` from every path, including `/`.

  What the artifact directory does *not* yet contain is browser-side observability. `SEFER_LOG` reaches the Vite process, not the page; in a browser the ring mirrors `note` events to `console.debug` and is read through `__sefer.observability`. `observability.jsonl` currently holds the dev server's own stderr.

## Exploration and regression tests have different jobs

Use exploration to investigate a change, try awkward interactions, inspect telemetry, and produce reviewable evidence. Exploration can be valuable without producing a committed test script.

Start with agent-browser and local Chrome as a lightweight agent-facing interface. Existing Playwright tooling is also a valid way to explore; do not add a second harness solely to satisfy the tool preference. Choose one working driving route for the task.

Use deterministic Playwright tests for selected repeatable Web journeys. An agent-browser session may reveal such a test, but its command transcript is not automatically a regression test. Avoid turning every exploratory action into permanent suite maintenance.

Defer Lightpanda for editor verification. Its lack of real rendering makes it unsuitable as proof for layout, selection geometry, scrolling, or visual correctness. Revisit only for a concrete DOM-only use case.

## A useful verification run

1. Identify the behavior being checked and the observable result that would prove or disprove it.
2. Launch or select an isolated instance with known fixture data. Confirm the checkout/build, host, process, and readiness before driving it. Do not use a person's active project as scratch state.
3. Exercise the user's entry point and actions. Fixture setup may establish preconditions; internal state setters must not stand in for the action being verified.
4. Inspect the UI and relevant side effects. For save, compare actual persisted bytes and reopen behavior, not just the displayed success message.
5. Preserve evidence in a per-run local artifact directory. Record the actual directory in the report. Clean up only processes and scratch resources owned by the run; retain the proof.

`pnpm verify:launch` covers the fixture case: a dev server on a free port against `/dev/fixture`, artifacts in `.verify/<runId>/`. Any route also takes `?fixture=1`, which composes over the seeded in-memory `fixtures/small-nt` instead of OPFS — enough to prove a screen renders, not enough to measure one.

## Driving a real project over CDP

A dedicated browser profile, so a person's own project is never scratch state. These commands were run, in this order, and work.

**1. A profile of our own, with the debugger on.** Chrome 136+ refuses remote debugging on the default data directory, which is also where a person's real OPFS lives — so a dedicated `--user-data-dir` is not a nicety, it is the only way in.

    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
      --user-data-dir="$HOME/.sefer-cdp-profile" \
      --remote-debugging-port=9222 --no-first-run --no-default-browser-check

Connect with `chromium.connectOverCDP(...)`. **Check both `http://127.0.0.1:9222` and `http://[::1]:9222`** — which one answers has changed between launches, and the other refuses the connection outright.

**2. Import a corpus through the product's own door.** The profile starts with an empty OPFS. Do not hand-write storage; use the importer, so what is measured is what a person would have:

    delete globalThis.showDirectoryPicker   // in page.addInitScript

The web host prefers the File System Access picker, which is a native dialog no automation can drive, and falls back to a `webkitdirectory` input when it is absent (`platform/web/intake.ts`). Removing the global takes the fallback, and Playwright's `filechooser` event then accepts a DIRECTORY path. `../scripture-kitchen/testData/exampleCorpora/en_ulb` imports as 66 books at `/sefer/projects/en_ulb`.

**3. Measure the production build, not the dev server.** Vite dev serves every module as its own request — thirty of them for one route, in a four-level waterfall — which is real but is not what anyone ships. Serve the build on the SAME ORIGIN, or the profile's OPFS (and the project) will not be there:

    pnpm build && pnpm serve --port 3000 --strictPort   # the dev server's own port

**4. Prefer the longest task to the wall clock.** CDP `Tracing` with `devtools.timeline`, `performance.mark` either side of the interaction, then the top-level tasks in the window. A single 69ms task and two 34ms tasks take the same total time and do not feel the same; the second is the one that keeps typing responsive. A sampling profile (`Profiler.*`) correlated to a task's window by timestamp is what names the functions inside it — the timeline alone will only say `EventDispatch`.

## Evidence that humans and agents can inspect

Keep a compact record of intent, fixture, build/revision (including dirty-tree status), platform, actions, observed result, and limits. Add screenshots or a trace where useful, console/errors, and relevant file/content checks. Evidence may show success or failure; a final screenshot alone rarely explains either.

Plan for a small read-only observation surface exposing current document revision, saved revision, analysis revision, pending operations, and recent failures. Correlate observations to the action under review. These observations supplement external checks; app-reported success does not prove a disk write.

Keep artifacts local by default and use controlled fixtures. Verification must not depend on a hosted telemetry service or production phone-home behavior. Logging storage, Effect tracing, retention, and export design remain a separate decision; this document does not select a framework or authorize a replay engine.

## When exploration earns a test

Promote a finding when it protects a durable user promise, reproduces a consequential defect, or covers a repeated failure risk. Choose the owning seam from [testing](testing.md).

A UI-discovered save race may belong in a deterministic Node test with controlled asynchronous completion. A rendering/selection bug belongs in a real browser test. A complete Web journey belongs in Playwright; an actual native filesystem/IPC defect needs desktop coverage.

When promoting a journey, distill the exploration into a minimal fixture, stable user-facing selectors, explicit actions, observable assertions, and reliable cleanup. Remove incidental navigation and timing sleeps. Where practical, demonstrate that the test fails for the original defect and passes with the fix. Do not commit generated scripts solely because the agent produced them.

## Grow the runbook from working features

When the first vertical slice works, add its verified launch/health/drive/cleanup recipe and a short feature map: how a user reaches it, what to do, and what proves the result. Link existing automated tests instead of copying their steps into a second detailed specification. A future agent skill should point here rather than duplicate this guidance.

References: [agent-browser](https://github.com/vercel-labs/agent-browser), and [the verification-skill pattern](https://github.com/cursor/plugins/blob/main/pstack/skills/create-verification-skill/SKILL.md).
