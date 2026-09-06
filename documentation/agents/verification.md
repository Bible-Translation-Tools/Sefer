# Agent verification

Status: agreed workflow direction. This is not yet an executable app-specific skill: exact launch isolation, readiness checks, and desktop driving recipes must be proved as the application takes shape.

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

The future launch helper should provide a unique profile/data directory, endpoint, readiness check, and run identity. Publish its exact commands here only after running them successfully. Until then, consult current scripts and report unavailable capabilities explicitly.

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
