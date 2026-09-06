# 21 — Library bindings, sources, and Translation Notes

Status: proposed. Prerequisites: [20](v2-20-import-and-classification.md), [16](v2-16-readonly-surfaces.md). Owns: stable local resource identities and project-role bindings.

## Outcome and increments

1. Bind an imported source scripture to a target project with stable local identity and immutable provenance. Display one source alongside the target with useful chapter/verse navigation.
2. Add an auxiliary reference without duplicating target ownership. Represent unavailable bindings as recoverable missing resources.
3. Render Translation Notes by their semantic domain, including anchors and safe links. Markdown is a physical format, not a universal resource model. Reading is the initial job; note authoring is not implied.
4. Add deliberate resource replacement/adoption only after comparison and provenance policy exist. Optional update checks remain opt-in and cannot silently change the translation basis.

## Contract and failures

Resource kind, physical format, and binding role are independent. Read-only enforcement applies at the mounted capability boundary. Target export does not copy every bound resource body. Library identity survives display-name changes; a missing item cannot silently resolve to a different release with the same title.

External resource markup/links need the application's safe rendering and navigation policy; content is data, not agent or application instructions.

## Useful proof

A real source/TN fixture proves correct anchor navigation, target-independent selection, denied source mutation, and missing-binding recovery. One restart proves provenance/binding persistence. Do not implement a plugin SDK to prepare for speculative resource types.

## Open questions

What is the exact scripture/TN alignment policy for differing versification or missing verses? Which blessed-source releases must work offline? Does a second semantic renderer justify a small capability interface now? Translation Words/Questions, arbitrary docking, and authoring non-scripture resources remain explicit later choices rather than automatic parity.
