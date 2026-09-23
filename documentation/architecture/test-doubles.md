# Nearly no mocks testing

- **Status:** the test-double policy (moved from planning 2026-09-23)
- **Goal:** maximize evidence from real behavior while keeping the ordinary feedback loop fast and deterministic
- **Related guidance:** [`documentation/architecture/testing.md`](testing.md)

## Thesis

Sefer controls nearly its entire stack and depends on little network behavior. Its tests should therefore execute real production code by default: real domain functions, real CodeMirror state, real Galley WASM, real Effect programs and Layers, real serialization, real browser behavior, and real host adapters in a smaller number of boundary tests.

Mocks are often attractive because they make a test easy to arrange. They also let the test pass when the components no longer integrate, encode private call sequences as requirements, and create a second imagined application for agents to maintain. Sefer should accept those costs only when a real dependency cannot be made deterministic, safe, and fast enough at the owning seam.

“Nearly no mocks” does not require every test to launch the packaged desktop application or touch a user's files. The policy distinguishes interaction mocks from controlled resources and intentionally simple production implementations.

## Terms

### Real implementation

The same code and contract used by the application. Examples: CodeMirror `EditorState`, the actual save coordinator, the pinned Galley artifact, the Web persistence adapter, and Tauri commands.

### Controlled real resource

A real implementation pointed at disposable inputs owned by the test: a temporary directory, isolated browser profile, fixture USFM project, fake clock supplied through an explicit Clock service, or loopback server. These are preferred when they exercise the production mechanism safely.

### Deterministic implementation of a production port

A small implementation selected through the same composition seam as Web or Tauri, such as an in-memory repository that obeys the complete production port contract. This is acceptable for testing application policy when the host mechanism is not the subject. It must be reusable, stateful enough to expose real semantics, and tested against the same contract as production adapters. Do not call it a mock or add assertion APIs to it.

### Mock, stub, or spy

Test-only behavior that returns scripted answers, replaces a module, records calls for expectations, or simulates a collaborator incompletely. This is disfavored. A spy used only to observe a genuine public effect may occasionally be justified, but prefer observable state, structured telemetry, or the collaborator's real output.

## Default rules

1. Test through public behavior and durable state. Assert the canonical document, saved bytes, revisions, diagnostics, visible UI, or structured operation result.
2. Use real collaborators inside the process. Do not mock CodeMirror, Solid reactivity, Effect, Galley, serializers, routers, or application services merely to isolate a unit.
3. Isolate through explicit production ports, not module mocking or dependency-loader tricks.
4. Prefer a temporary real resource when it is cheap and deterministic.
5. Use a deterministic port implementation when the test owns application policy rather than platform mechanics.
6. Give every production adapter a shared contract suite, plus at least one real vertical journey through the deployed path.
7. Do not assert internal call counts or ordering unless that order is itself a public safety contract. Observe the resulting state and telemetry.
8. Simulate failures through real controllable mechanisms or explicit failure-capable ports. Do not monkeypatch globals to throw.
9. Keep fixtures small, legible, standards-relevant, and reusable. A fixture represents input; it does not precompute the behavior under test.
10. If real testing is slow, measure setup, compilation, resource creation, and execution separately before substituting behavior.

## Expected strategy by seam

### Pure application and editor policy

Call real functions with concrete values. For mutation behavior, construct actual CodeMirror state and transactions. Use parameterized cases or property tests where they protect an invariant. No component, dispatch, or Galley mocks.

### Galley integration

Use the actual pinned WASM/facade against a small committed USFM corpus. Sefer does not repeat Onion or Sous's exhaustive semantic suites, but it does prove loading, version/provenance, input/output wiring, coordinate publication, malformed-input behavior required by the editor, and representative full-book performance.

Do not maintain hand-authored fake diagnostics as the primary integration oracle. A narrow deterministic diagnostic value may be used only when testing UI policy that requires a difficult state, and should enter through a production-shaped findings store rather than a mocked Galley module. Prefer fixture text that makes real Galley produce the state.

### Effect services and application orchestration

Run the real Effect program. Supply real test Layers: temporary filesystem, deterministic Clock/Random when time or identity is part of the contract, and an in-memory implementation of an explicit production repository where platform persistence is outside the test's scope.

Do not mock individual Effect functions or assert service-method call counts. Test success values, typed failures, interruption/cleanup, resulting state, and structured telemetry. Shared adapter contract tests prevent the in-memory implementation from quietly becoming a different system.

### Filesystem, save, and recovery

Most save/recovery tests should use a real temporary directory and real bytes. This is cheap, deterministic, and exercises atomic-write and path behavior that memory cannot reproduce. Bind each test to its own directory and clean up only that directory.

Use a deliberately controllable filesystem port for races and rare failures that cannot be produced portably—save completion out of order, disk-full, permission denial, interrupted rename. It should model only the production contract and expose explicit control over completion; avoid a general scripted mock framework. Verify ordinary behavior again through the native adapter.

### Browser UI

Use a real browser, real Solid components, real CodeMirror, and production routing. Seed state through the same import/open boundary a user or production adapter uses. Do not mock layout, selection, clipboard, composition, focus, or browser storage when those behaviors are the question.

Focused Browser Mode tests may use a small real component harness. Playwright journeys use the real Web adapter. Browser APIs that cannot be driven authentically remain explicit empirical checks rather than falsely passing simulations.

### Tauri desktop

Use WebdriverIO for a small number of actual packaged/dev-binary journeys through real IPC, permissions, filesystem paths, restart, recovery, logging, and platform webview behavior. Frontend tests may compose against an in-memory or Web implementation when desktop behavior is irrelevant, but must not claim Tauri coverage.

Use Tauri's official test facilities only at an existing boundary. A test that mocks `invoke()` proves frontend command handling, not Rust integration; name it accordingly and retain a real IPC journey for every critical command family.

### Network and remote services

No general HTTP mocking layer is needed initially. For stable public protocols under Sefer's control, use a loopback server implementing the real protocol and schemas. For third-party or unavailable systems, record a small contract fixture only after defining freshness and provenance, and retain a separate opt-in real-service check when consequential.

## Failure testing without mock sprawl

Failures are part of production port contracts. Design narrow control points into test implementations rather than patching modules:

- manual completion for an asynchronous write;
- bounded storage that returns a typed capacity error;
- deterministic clock advancement;
- explicit cancellation and scope closure;
- corrupted fixture bytes at the real parser boundary;
- temporary permissions where portable and safe;
- process restart against an isolated application data directory.

The control mechanism should state the condition being created. Avoid queues of anonymous “next call returns X” instructions.

## Contract suites

For every port with more than one implementation, define behavioral examples once and run them against each applicable implementation. Examples for a book repository include exact byte preservation, missing-file result, overwrite policy, captured-revision receipt, atomic replacement where promised, cleanup, and typed failure mapping.

Not every implementation can satisfy every host capability. Make capability differences explicit instead of weakening the shared contract or branching assertions invisibly.

The deterministic implementation is not automatically trustworthy because tests use it. It earns trust by passing the shared contract and remaining smaller than the production adapters.

## Escape hatch: when a mock is justified

A mock requires a short comment at the test explaining why a real or deterministic production-shaped implementation is unsuitable. Acceptable reasons may include:

- destructive or externally billable behavior;
- a third-party service that cannot be run locally;
- an otherwise unreachable failure needed to protect a safety contract;
- a platform facility unavailable in the current test environment;
- a deterministic race that requires manual completion control.

“Faster,” “easier,” and “unit isolation” are insufficient without a measured problem. Keep the mock at the narrowest existing port, return domain results or typed failures, and avoid inspecting private calls. Add a real boundary check when the mocked seam is important.

## Adoption sequence

1. Remove the scaffold counter test when the scaffold is replaced; do not use it as the template for architecture.
2. Establish fixture ownership and isolated temporary project helpers.
3. Build one real CodeMirror behavior test and one real Galley facade contract.
4. Define the first Web/Tauri persistence port from a real save slice.
5. Run shared contracts against a deterministic implementation and the real Web/Tauri adapters where applicable.
6. Add one real Web save/reopen journey and one real desktop save/restart journey.
7. Add controllable failure implementations only for named races or failures that real resources cannot express reliably.
8. Track suite time by category and promote slower real checks to an appropriate cadence only after measurement.

## Review checklist

For each test double, ask:

- Is this replacing code or a resource we control?
- Can a real implementation use a temporary resource cheaply?
- Is there already a production port at this boundary?
- Does the test assert behavior or internal collaboration?
- Could the double disagree with production while the test passes?
- Does a shared contract constrain it?
- Is a real vertical slice responsible for the omitted integration?
- Is the test's claimed scope named honestly?

## Open questions

- Which save/recovery failures can be induced portably with temporary files, and which need a controllable filesystem implementation?
- Should deterministic Clock and Random be universal root services or introduced only when a real operation needs them?
- What is the smallest committed USFM corpus that proves Sefer/Galley integration without duplicating sibling suites?
- Can Web storage tests use the real browser adapter cheaply enough in the default loop?
- Which Tauri commands are safety-critical enough to require a real desktop journey on every merge?
- How should shared port contracts express platform-specific capabilities such as atomic replacement?
- Which external resources, if any, need recorded fixtures and freshness rules?
- What suite-time thresholds trigger a cadence change rather than replacement with mocks?
- Should a lint or review rule flag module mocks and spy assertions, or is documented review sufficient?

## Non-goals

- banning dependency injection or alternate production implementations;
- launching the full desktop application for every domain invariant;
- repeating Onion/Sous exhaustive tests in Sefer;
- manufacturing hard-to-reproduce OS failures unsafely;
- treating snapshots or telemetry as the sole correctness oracle;
- maximizing test count or coverage percentage.
