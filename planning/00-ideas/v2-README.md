# Sefer v2: proposed work slices

Status: ideas for discussion, prepared 2026-09-04. This collection authorizes no implementation, installation, sibling-repository changes, or feature removal. Numbers are stable reading references, not a sprint schedule. Each document contains increments that should become separate small implementation plans only when selected.

## Start here after vacation

1. Read [the current-source review](v2-source-review.md). The engine and editor donor have materially advanced since the original vision. Some older documentation now contradicts the implementation.
2. Recheck the named revisions and dirty-tree state before choosing an engine artifact. The current Rust Pantry/Expediter work is not equivalent to a shipped composed WASM package.
3. Select the first vertical outcome: open a small local book, edit its exact canonical source, see meaningful evidence, save, and reopen the saved bytes. Combine the relevant small increments from 01–04, 06, 09–10, and 12; do not finish every foundation document before showing a working application.
4. In parallel in the roadmap, resolve the visual-editor viability questions in 05–08. Source editing alone does not pass the translator-facing editor gate. This is sequencing guidance, not a request to run parallel agents.
5. Add crash recovery before calling the editor dependable. Then whole-project findings, sources, search, and history become useful independently.

The [original vision](../../../scripture-editor-proto-2/plans/editor-v2-rewrite-vision.md) remains the product baseline. This collection translates it into candidate slices, highlights changed evidence, and leaves unresolved product choices visible. It is not a claim that v1 parity has been audited screen by screen.

## Inherited constraints

- One canonical LF whole-book CodeMirror state and content history for each instantiated book. Project source can be loaded for analysis without mounting editors everywhere.
- The editor owns working text. Current Rust Pantry retains a last-supplied target-text copy; update it with whole-book source. No application-maintained splice protocol or second independently editable document.
- Ordinary editor admission, analysis needed for editing, mutation, and publication should remain synchronous within the interaction budget. File I/O, recovery, Git, and export run outside that path. An asynchronous write still needs ownership, errors, and a receipt.
- Effect earns its place at asynchronous operation/lifecycle boundaries and observability. Do not turn every CodeMirror rule into an Effect program or allocate a fiber per transaction event.
- Local evidence is first-class: bounded recent events, queryable JSONL where persisted, operation/revision correlation, selectable volume. No required capture-session ceremony, PubSub, replay recorder, or phone-home telemetry.
- Desktop projects and Git live on real native disk. Web storage has its own real adapter. One filesystem capability per host is a candidate; faithful semantics and the Git IPC probe decide its shape.
- Nearly no mocking: real engine, CodeMirror, Effect programs, temporary files, isolated browser storage, and actual desktop seams. Controlled failure implementations are narrowly justified doubles, not automatically production truth.
- Test the question at its owning seam. No transplant of sibling corpora or spike test counts as a coverage target. Add runners and abstractions when a selected slice needs them.

## Proposed capability sequence

### Establish a usable, inspectable core

- [01 — Boot and dependency composition](v2-01-boot-and-composition.md)
- [02 — Fast verification and nearly no mocks](v2-02-verification-and-test-cadence.md)
- [03 — Versioned engine consumer boundary](v2-03-engine-consumer-boundary.md)
- [04 — Source ingestion and book lifetime](v2-04-source-and-book-lifetime.md)
- [05 — Bring forward the editor donor deliberately](v2-05-editor-donor-and-policy.md)
- [06 — Canonical transaction funnel and undo](v2-06-transactions-and-undo.md)
- [07 — Source, visual, chapter, and book views](v2-07-visual-and-chapter-views.md)
- [08 — Real input, accessibility, and writing systems](v2-08-input-and-accessibility.md)

### Make editing durable and diagnosable

- [09 — Native disk and Web storage](v2-09-platform-storage.md)
- [10 — Save receipts and external changes](v2-10-save-and-external-change.md)
- [11 — Crash recovery and restore](v2-11-recovery.md)
- [12 — Bounded local observability](v2-12-observability.md)

### Make the whole project useful

- [13 — Project census and composed analysis](v2-13-project-analysis.md)
- [14 — Findings, navigation, and freshness](v2-14-findings.md)
- [15 — Programmatic fixes and formatting](v2-15-fixes-and-formatting.md)
- [16 — Read-only surfaces and lifetime](v2-16-readonly-surfaces.md)
- [17 — Editable satellites and apparatus](v2-17-editable-satellites.md)
- [18 — Project find and one-match replacement](v2-18-search-and-replace.md)
- [19 — Commands, settings, routing, and localization](v2-19-shell-commands-and-localization.md)

### Preserve the translator's surrounding workflows

- [20 — Import and resource classification](v2-20-import-and-classification.md)
- [21 — Library bindings, sources, and Translation Notes](v2-21-library-and-reference-resources.md)
- [22 — Drafting, Form workflows, and Match Formatting](v2-22-drafting-and-structured-workflows.md)
- [23 — Saved comparison and safe revert](v2-23-diff-and-revert.md)
- [24 — Effect filesystem and desktop Git probe](v2-24-effect-filesystem-and-git-probe.md)
- [25 — Repository lifecycle and Previous Versions](v2-25-git-lifecycle-and-history.md)
- [26 — Remote attachment and publication](v2-26-remote-workflows.md)
- [27 — STET comparison and navigation](v2-27-stet.md)
- [28 — Multi-book operations](v2-28-multi-book-operations.md)
- [29 — Performance and memory evidence](v2-29-performance-and-memory.md)
- [30 — Packaging, offline operation, updates, and cutover](v2-30-release-and-cutover.md)
- [31 — Project rename, delete, metadata, and export](v2-31-project-management-and-export.md)

## Decision gates, not layers to build in isolation

**Editor foundation (vision A):** 03–08. Exact source, credible protection, selection, source repair, and Undo. Real input evidence is part of this gate.

**Satellite correctness (B):** 16–17. Read-only surfaces can precede this gate; editable result cards and apparatus cannot bypass it.

**Engine integration (C):** 03, 13–15, 29. Real packaged consumer, explicit publication coordinates, current source identities, useful diagnostics, measured whole interaction. Rust-only evidence does not close the Web/Tauri gate.

**Durable editing (D):** 09–11, 23. Correct revision receipts, recoverable interruptions, independent saved comparison. Git history is additional protection, not a substitute.

**Whole-project behavior (E):** 13–15, 18, 20–22, 27–28, 31. Unopened books matter; target/reference authority remains explicit.

**Platform parity (F):** each capability's real adapter evidence plus 30. The same frontend does not prove equivalent filesystem or webview behavior.

**V1 retirement (G):** the full capability disposition ledger in the vision reconciled with live v1 jobs, support decisions, and evidence. No silent drops because a card is late.

## Keep the planning surface small

These are ownership boundaries and user outcomes, not instructions to create 31 packages, services, test suites, or folders. Several cards can share an implementation module. A card should be merged or retired when its distinct question disappears.

When selecting an increment, record its concrete outcome, owning files, prerequisite decision, failure behavior, and one useful proof. Move the selected work through the repository's planning flow; retain links here. Keep architecture guidance short and update it when a decision lands. Do not load this entire backlog into every coding task.

Do not add blanket adapter suites for trivial wrappers. Share behavioral examples when multiple implementations actually promise the same consequential semantics. A controlled clock is a test double; a real temporary directory is a controlled real resource. Those terms need tightening in the earlier [nearly-no-mocks proposal](nearly-no-mocks-testing.md) when it is next promoted.

## Existing discussions to extend

- [Local observability and agent evidence](local-observability-and-agent-evidence.md)
- [Nearly no mocks](nearly-no-mocks-testing.md)
- [Isomorphic Git, Effect filesystem, and lifecycle](../01-discussing/isomorphic-git-effect-filesystem-lifecycle.md)
- [Testing shorthand](../../documentation/architecture/testing.md)
- [Agent verification](../../documentation/agents/verification.md)
- [Observability shorthand](../../documentation/architecture/observability.md)

No application code or dependencies were changed to create this collection. Source inspection and document validation are the evidence for these proposals; no application tests or performance runs were performed for this planning pass.
