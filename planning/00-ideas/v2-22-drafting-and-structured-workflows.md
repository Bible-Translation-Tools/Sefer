# 22 — Drafting, Form workflows, and Match Formatting

Status: proposed, product investigation first. Prerequisites: [06](v2-06-transactions-and-undo.md), [20](v2-20-import-and-classification.md), [21](v2-21-library-and-reference-resources.md) as the selected job requires. Owns: preservation/redesign of translator jobs; upstream owns USFM generation/transformation.

## Outcome and increments

1. Audit the v1 drafting, Form/body-editing, and Match Formatting workflows as three related but distinct jobs. Record representative inputs, output source, user choices, and behaviors that must survive. Do not call the audit complete from the vision alone.
2. Implement a minimal new-target/drafting skeleton flow using an upstream capability or an explicitly scoped upstream request. Users should not need to hand-author scaffolding.
3. Prove the smallest structured editing interaction over canonical source. If it requires satellites, use [17](v2-17-editable-satellites.md); otherwise keep it as a normal editor command or form that submits guarded changes.
4. Design Match Formatting as reference-correlated transformation with preview/source identity guards. It is not automatically ordinary formatting with another label.

## Contract and failures

No durable JS semantic tree competes with canonical USFM. Generated edits enter the normal funnel and remain undoable. Missing reference structures, ambiguous correspondence, or changed target source must produce a useful refusal/choice rather than guessed destructive edits.

## Useful proof

Start with a written before/after example agreed with the owner. Then test actual transformation output and one real interaction that preserves the intended job. A donor Lexical snapshot is not the desired oracle. Keep sibling formatter/generator tests upstream.

## Open questions

What portion of Form behavior is required, and what can be redesigned? Which scaffold markers/metadata vary by project? How is reference alignment established for Match Formatting? These are cutover-ledger questions; deferring implementation does not de-scope the user jobs. Avoid forcing a large legacy UI port before answering them.
