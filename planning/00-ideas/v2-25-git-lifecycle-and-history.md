# 25 — Repository lifecycle and Previous Versions

Status: proposed. Prerequisites: [10](v2-10-save-and-external-change.md), [12](v2-12-observability.md), [23](v2-23-diff-and-revert.md), [24](v2-24-effect-filesystem-and-git-probe.md). Owns: repository operations and historical user jobs.

## Outcome and increments

1. Model open/absent/initializing/ready/busy/unhealthy/closing/closed as explicit lifecycle distinctions, with typed results and operation spans. Refine the existing discussion's diagram to cover failed opening, interruption, close-while-busy, and failed cleanup; it is not yet an exhaustive transition contract.
2. Implement local status and an intentional version checkpoint. Coordinate with save so the committed files are the intended durable snapshot, not a mix of concurrent saves. Serialize relevant mutations without assuming an app queue locks external Git processes.
3. Add Previous Versions, Save as New Version, and Back to Latest using immutable historical reads and [23](v2-23-diff-and-revert.md). Keep ordinary Undo and recovery independent.
4. Add explicit restore and unhealthy-repository recovery choices. No automatic destructive `.git` repair.

## Contract and failures

A save can succeed while a checkpoint fails; report both honestly. An interrupted Promise may leave native mutation running or completed. Reconcile refs/working-tree state before declaring ready or retrying, and never retry a non-idempotent operation blindly. Close has bounded optional telemetry flushing and an explicit policy for active mutations.

Historical preview is not checkout by default. Back to Latest restores the current viewing context without silently throwing away working edits. Destructive restore needs product-defined confirmation and recovery semantics.

The later, read-only book/chapter slider and its performance questions are captured in [Next Git considerations](../01-discussing/next-git-considerations.md). That discussion starts from the Git port and History panel now present in Sefer; this earlier slice remains a proposal rather than a current-state inventory.

## Useful proof

Real temporary repositories prove init → commit → history → reopen, plus save/checkpoint overlap and operation-specific failure recovery. Inspect bytes/refs and lifecycle evidence. One desktop journey proves actual disk persistence. Use controlled failures only for unreachable interruption windows; do not mock Git to test Git lifecycle.

## Open questions

What starts hidden checkpoints and how often? Can reads overlap mutations safely? How are external Git changes detected? Which failures imply corruption versus a recoverable operation error? What does close do when an operation cannot cancel? These answers belong in the selected transition plan before implementation.
