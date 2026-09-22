# Generate the Tauri command bindings instead of hand-typing them

**Not now.** A trigger, so it is a decision somebody makes rather than one that
expires.

## The shape today

23 `#[tauri::command]`s — 18 in `src-tauri/src/git.rs`, 3 in `credentials.rs`,
2 in `updater.rs` — against roughly 17 hand-written `call<T>("name", {...})`
sites in `src/platform/tauri/`. The command name is a string and the argument
object is whatever the caller typed; nothing checks either against Rust.

There is one hole worth naming: `transfer(command: string, repo, auth)` in
`src/platform/tauri/remote.ts` dispatches `git_fetch`, `git_pull` and
`git_push` through a VARIABLE command name, so no hand-written type covers
those three at all. They are also the three whose signatures changed on
2026-09-22, when fetch and pull took `Option<String>` for the credential.

## Why not yet

The failure mode for signature drift is a serde error at runtime, in
development, with a message that says which field it could not deserialise.
Annoying, not dangerous. `gitContract` and the Rust unit tests in `git.rs`
already catch semantic drift, which is the more expensive kind.

Against that, tauri-specta v2 (Tauri 2.11 here, so it fits) means a macro on
every command, a bindings-generation step, and a CI check that the generated
file is current — a build-system change, and one whose value is proportional to
how often the Rust surface moves and how many people move it.

## The trigger

Do it when either is true:

- the Rust command surface passes about 30, or
- a second person starts editing `git.rs`.

Both are the point where "a runtime error in dev" stops being a cheap way to
find out.
