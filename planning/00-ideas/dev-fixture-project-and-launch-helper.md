# Dev fixture project and the verification launch helper

Status: idea for discussion, 2026-09-06. Answers a gap the previous app never closed: an agent or a developer cannot quickly land in an always-present project without driving a file picker. Authorizes nothing.

## The fixture project

- A dev-only route, `/dev/fixture`, compiled only when `import.meta.env.DEV` is true; tree-shaken from production builds and asserted absent by a build test.
- It boots the ordinary open-project path with one substitution: the `FileSystem` Layer is a `FixtureProject` implementation pre-seeded from vendored files under `fixtures/small-nt/` (candidates: Philemon, Jude, 3 John, one Psalm for poetry; a deliberately malformed book for findings). Everything above the Layer is production code: source, editor, findings, satellites.
- Deterministic: the route resets the seeded state on load unless `?keep=1`, so a run always starts from the same bytes.
- Tauri: the same seed behind a launch flag or environment variable that populates a temporary directory, so the native disk path is exercised, not bypassed.
- A read-only observation surface next to it (`/dev/state` or the dev object on `globalThis`): current revision, saved revision, analysis revision, pending operations, recent failures, and the observability ring. App-reported success never stands in for a disk check.

## The launch helper

One command, `pnpm verify:launch [--host web|tauri] [--fixture small-nt]`, that:

1. picks a free port and creates a unique run directory (profile or data dir, artifacts, run id);
2. starts the dev server or Tauri with the fixture seed pointed at that directory;
3. polls a readiness endpoint (the fixture route responding, boot note present in the observability ring);
4. prints the URL, run id and artifact directory as one JSON line an agent can parse;
5. tears down processes on exit and leaves the artifacts.

Browser Mode tests, Playwright journeys and agent-browser sessions all enter through the same fixture route. E2E still tests real import separately.

## Not this

No seeding through internal state setters in place of the user's action; no second document model for fixtures; no hosted telemetry; no production code path that knows it is under test beyond the swapped Layer.
