//! The one vocabulary the TypeScript side maps back into typed failures.
//!
//! Every command in this crate returns `Result<T, String>`, and Tauri hands
//! that string to `invoke`'s rejection. A bare message would force
//! `src/platform/tauri/*.ts` to pattern-match on libgit2 prose, which changes
//! between releases — so each failure is prefixed with a stable reason name
//! and the TS adapters read only the prefix.
//!
//! The names line up deliberately with the two core error types:
//!   `GitError.reason`    — NotARepository | Io | Conflict | Refused
//!   `RemoteError.reason` — Unavailable | Unauthorized | Network | Rejected
//! `AuthFailed`, `Offline` and `Rejected` are the transport half; `Io` is the
//! catch-all, and an unprefixed string (which should not happen) is read as
//! `Io` so a new failure degrades to "something went wrong" rather than being
//! silently treated as success.

/// The repository the caller named does not exist or is not a repository.
pub const NOT_A_REPOSITORY: &str = "NotARepository";
/// Storage or the object database refused the operation.
pub const IO: &str = "Io";
/// The repository's state contradicts the request: a divergent pull, a rev
/// that names nothing, a detached HEAD where a branch was needed.
pub const CONFLICT: &str = "Conflict";
/// Sefer declined before touching the repository (a path outside the root).
pub const REFUSED: &str = "Refused";
/// The remote rejected the credential, or none was supplied.
pub const AUTH_FAILED: &str = "AuthFailed";
/// The transport never reached the remote: offline, DNS, timeout.
pub const OFFLINE: &str = "Offline";
/// The remote reached us and said no: non-fast-forward, no write access.
pub const REJECTED: &str = "Rejected";

/// `"<reason>: <detail>"` — the only shape a command's error string ever takes.
pub fn fail(reason: &str, detail: impl AsRef<str>) -> String {
    format!("{reason}: {}", detail.as_ref())
}
