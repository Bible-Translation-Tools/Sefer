# 09 — Native disk and Web storage

Status: proposed. Prerequisite: [04](v2-04-source-and-book-lifetime.md). Owns: host filesystem capabilities. [24](v2-24-effect-filesystem-and-git-probe.md) decides the broader Effect/Git compatibility shape.

## Outcome and increments

1. Read and write one disposable native project through real Tauri IPC, with scoped project authority and typed missing/permission/capacity failures. Keep project source on native persistent disk.
2. Implement the same selected domain operation against real browser storage, initially OPFS per the existing discussion. Browser import/export and access persistence are explicit host behavior.
3. Separate project source, metadata, recovery, cache, and diagnostic-log roots. Identify what survives restart and what may be rebuilt or evicted.
4. State the actual replacement guarantee for each supported filesystem. Add only the primitive needed for a snapshot-bound save; generic write/rename calls do not establish atomicity or crash durability by themselves.

## Contract and failures

UI code receives project/book capabilities, not unrestricted raw path authority. Handle path normalization and authorization at their owning boundaries, including symlink/root escapes where native access permits them. No desktop OPFS mirror or eventual copy-to-disk authority.

OPFS quota/eviction and native rename/locking behavior differ. Do not advertise one guarantee by silently weakening assertions on one host. A generic Effect FileSystem implementation is useful only if its methods have honest semantics.

## Useful proof

Real temporary directories and isolated browser profiles prove read/write/reopen and declared replacement behavior. One Tauri journey verifies actual IPC and denied access outside the allowed test root. Use a narrow controllable failure implementation for disk-full/rename interruption only when safe real induction is not portable.

## Open questions

Managed projects or user-selected external folders, and when? Which durability guarantees require a small Rust command rather than plugin-fs composition? How are persisted grants restored? What does a browser storage-loss state tell the user? Do not create an abstraction for every possible filesystem operation before [10](v2-10-save-and-external-change.md) exposes the required contract.
