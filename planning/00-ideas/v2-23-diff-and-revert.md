# 23 — Saved comparison and safe revert

Status: proposed. Prerequisites: [06](v2-06-transactions-and-undo.md), [10](v2-10-save-and-external-change.md), [16](v2-16-readonly-surfaces.md). Owns: snapshot comparison and application of chosen source changes.

## Outcome and increments

1. Compare the current canonical book with its actual saved baseline using scripture-aware upstream diff where available. Clearly label each side's identity and serialization basis.
2. Navigate changed source and revert one current hunk through the canonical funnel. Refuse/recompute if source changes after comparison. Revert itself is an ordinary undoable edit.
3. Reuse the surface for a historical or external source snapshot with explicit provenance. Start with read-only comparison and ordinary editor output; editable merge panes are not required.
4. Support an initial left/right choice workflow when the product requires merge resolution. Keep unresolved/partial choices explicit; do not silently introduce N-way merge or a second output document authority.

## Contract and failures

Saved baseline, Git history, recovery, and external comparison are distinct identities even when their texts match. Diff anchors cannot survive arbitrary drift by assumption. A historical preview does not change the latest saved baseline just because it is displayed.

## Useful proof

A tiny real diff fixture includes a structural edit and Unicode. Verify hunk revert → Undo restores the original working source and that a stale hunk is refused. One browser journey proves labels and navigation. Do not duplicate the engine's full diff corpus or assert screenshot geometry as edit correctness.

## Open questions

What normalization belongs in comparison without hiding meaningful source changes? How are mixed newline-only external edits displayed? What user choices are needed for recovery conflicts? Which upstream diff/merge APIs are actually shipped in the selected artifact? Historical navigation joins [25](v2-25-git-lifecycle-and-history.md).
