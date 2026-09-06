# 02 — Fast verification and nearly no mocks

Status: proposed. Prerequisite: a selected behavior to protect. Owns: evidence placement and cadence. Extends [the existing testing proposal](nearly-no-mocks-testing.md) and [testing guidance](../../documentation/architecture/testing.md).

## Outcome and increments

1. Establish tiny shared input fixtures and isolated temporary-project helpers as the first real tests require them. Record which question each fixture answers; use invented manuscript text and public fixtures with known provenance.
2. Use Node Vitest for Sefer policy, real CodeMirror state, and compatible real WASM integration. Remove reliance on jsdom for those tests. Keep a DOM emulator only if an actual low-risk component test benefits; do not install both jsdom and happy-dom to hedge.
3. Add Browser Mode for real selection/layout/editor behavior. Add a few Playwright journeys for whole Web workflows. Add WebdriverIO when a real Tauri operation exists. Reuse fixture data and scenario intent, not a universal driver wrapper.
4. Let agent-browser explore in a real rendering browser, leave steps and local evidence, then promote an observed failure into a deterministic regression only when it protects a recurring risk. Lightpanda is optional nonvisual exploration, not an editor geometry/IME oracle.

## Cadence and acceptance

The edit loop runs the affected focused test. The ordinary gate covers fast application invariants; browser integration runs on relevant changes, full Web/desktop journeys on their boundaries and release gates. Start with a provisional approximately ten-second warm fast suite aspiration, then record actual setup/build/execution costs. Do not weaken data-safety checks to hit an invented number. Avoid running upstream stress corpora in the normal Sefer loop.

## Useful proof and failure ownership

One real save/reopen journey earns more than many mocked invoke assertions. Protect rare races with a narrow controllable failure implementation only when real resources cannot express them reliably. A fake clock or in-memory filesystem is a double; call its omitted semantics out honestly. Use shared contracts for consequential multi-adapter guarantees, not automatically every wrapper.

## Open questions

Which browsers/webviews are supported? Which native checks can run locally versus CI? How are genuine IME and screen-reader checks recorded? Current [Tauri guidance](https://v2.tauri.app/develop/tests/webdriver/) includes an embedded WebdriverIO route for macOS; pin and prove it rather than inheriting the old unsupported-macOS assumption. Keep test-only driver access out of production packaging. No coverage-percentage target or duplicate test in all five tools.
