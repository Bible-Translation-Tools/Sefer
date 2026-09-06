# 14 — Findings, navigation, and freshness

Status: proposed. Prerequisite: [13](v2-13-project-analysis.md). Owns: a unified application findings model and presentation, not detector logic.

## Outcome and increments

1. Adapt Onion and Sous outputs into a minimal application envelope: producer/rule, source identity, severity/category, semantic location, publication identity, and applicable action. Preserve producer-specific detail without reconstructing all engine data as JS objects.
2. Display project filters/counts and navigate unopened books. Use semantic location for identity and a separate presentation anchor when visual mode hides the source span.
3. Replace the whole applicable producer publication atomically. A failed refresh leaves an explicit stale/unavailable state rather than clearing errors to an apparently clean project.
4. Load occurrence/detail data on demand only if the engine boundary supports a version-bound query. Invalidate it when inputs or publication change.

## Contract and failures

Pattern row indices and array positions are not durable identities. A location from revision R cannot authorize an edit at R+1. Current source/raw coordinate mapping belongs at the engine wall. An enclosing navigation span that crosses hidden markup must not silently become a replacement range.

Filtering is presentation policy; hiding a category does not alter analysis truth. A missing or rejected book is not a zero-findings success.

## Useful proof

Real engine fixtures prove correct book mapping, a hidden-location navigation case, publication replacement that removes an old finding, and stale-detail refusal. UI-only filter logic can use small concrete envelope values without pretending they prove detector integration. Avoid golden snapshots of the whole corpus table.

## Open questions

What continuity should the UI preserve when an equivalent finding returns with a new publication? How should project counts represent incomplete analysis? Which details are cheap enough to include eagerly? Who localizes rule messages and arguments? Connect fixes only through [15](v2-15-fixes-and-formatting.md).
