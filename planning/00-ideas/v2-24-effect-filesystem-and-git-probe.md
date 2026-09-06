# 24 — Effect filesystem and the desktop Git probe

Status: proposed comparison gate. Prerequisites: [09](v2-09-platform-storage.md), one real save operation, selected candidate versions. Owns: compatibility evidence. Extends the [existing Git/Effect discussion](../01-discussing/isomorphic-git-effect-filesystem-lifecycle.md).

## Outcome and increments

1. Inspect the pinned Effect and isomorphic-git declarations. Inventory the filesystem operation union actually needed by source persistence, Git, and optional file logging. Decide whether full Effect FileSystem is honest on both hosts or a smaller Sefer service is clearer.
2. Implement/probe only the required Node-shaped `fs.promises` adapter over the chosen capability and one managed Effect runtime. Preserve errors, binary/string behavior, path semantics, and resource lifetimes. No runtime per filesystem call.
3. Exercise real isomorphic-git against isolated OPFS and real Tauri native disk. Desktop project files and `.git` must be persistent native files, with no browser-storage mirror.
4. Measure representative open/status/commit/history/restore/reopen with operation counts, IPC calls, bytes, wall time, main-thread stalls, and trace volume. Include a history-heavy fixture; clone/fetch/push only when selected. Compare native Git if the candidate approaches a user-visible limit.

## Contract and failures

Generic filesystem compatibility does not establish snapshot save or crash durability; those remain domain guarantees. Promise cancellation does not imply that already-issued native I/O stopped. Logging is an optional consumer of existing infrastructure, not justification for implementing a broad filesystem API.

The supplied Effect v4 pages could not be retrieved during planning; specific `PlatformLogger.toFile` wording from the earlier discussion remains unverified against v4. Resolve it from the selected package before writing implementation instructions.

## Useful proof and decision

Real repository bytes/refs after restart establish correctness. Use a small shared contract only for advertised compatibility semantics. Record a pass/fail recommendation: accept isomorphic-git on desktop, reduce measured redundant work, or retain a native/coarser Git boundary. Behavioral parity matters more than identical implementation. Do not build both production paths preemptively.

## Open questions

Which OPFS semantics do not fit the required Node contract? Is IPC chattiness tolerable? What locking/rename behavior matters on Windows? Can operation context survive the Promise bridge? No mirrored filesystem, generic cache protocol, or unbounded file-call tracing to make a benchmark look good.
