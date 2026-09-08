# Git, Remote, and project administration

Version control is a job someone asks for, never a side effect of editing. The source of truth is the
USFM bytes on disk; git records what Save already wrote.

## The port

`src/core/git/git.ts` defines `Git` (`Context.Service`) as the intersection of the user's jobs, not the
union of two libraries' APIs: `open`, `init`, `status`, `commit`, `log`, `show`, `previousVersions`. A
`Repo` is just its work-tree `root`. Every method fails with `GitError`, whose `reason` is
`NotARepository`, `Io`, `Conflict`, or `Refused` — a read that could not fail would force a host layer
to lie. `Version` pairs a `Commit` with `bytes()`, so a history list stays cheap and content is read
only when something displays or diffs it. Core names no library; `repositoryPath(root, path)` is the one
path rule the port owns — a saved path becomes repository-relative or `None`, and `None` means refuse.

## The receipts rule

`commit(repo, receipts, message, author)` stages exactly the paths in the receipts SaveCoordinator
produced, one at a time, and commits those. Nothing Save did not write can reach a commit — no untracked
scratch file, no editor backup, no `git add .`. A receipt path outside `repo.root` is `Refused` rather
than quietly skipped, because that is a bug upstream; an empty receipt list is `Refused` too, since an
empty commit records nothing true.

## Layers per host

The owner's decision (2026-09-06) is one implementation per host, not one library everywhere.

- `WebGitLive` (`src/platform/web/git.ts`) — `Layer<Git, never, FileSystem>` over isomorphic-git driven
  through `nodeFsView(fileSystem, Effect.runPromise)`, so Git reads the same OPFS bytes the editor saves.
  It installs the `Buffer` global from the `buffer` package at module load, for the reason
  [storage.md](storage.md) records; translates `statusMatrix` counters to the port's four `ChangeKind`s;
  and maps every thrown error to `GitError`.
- `TauriGitLive` (`src/platform/tauri/git.ts`) — a stub whose every method fails with `Refused`. Desktop
  will use git2 in Rust behind one Tauri command per port method, with Specta-generated bindings; the
  file's `TODO(seam)` header carries the shape. `@tauri-apps/api` is deliberately not imported, so the
  stub does not make the dependency look needed.

`gitContract(name, makeLayer, makeFileSystemLayer?)` in `src/core/git/contract.ts` is the acceptance
suite both must pass: init, empty status, a file written through `FileSystem`, a commit from one receipt,
then `log`, `show`, and `previousVersions` agreeing on it. It is exported and registered nowhere — the
tier each Layer belongs to is the registration site's decision.

## Remote is deferred

`src/core/remote/remote.ts` defines the port — `attach`, `fetch`, `pull`, `push`, `publish`, and
`progress(): Stream<Progress>` — plus `RemoteUnavailableLive`, which refuses every call with
`RemoteError({ reason: "Unavailable" })`. The four reasons (`Unavailable`, `Unauthorized`, `Network`,
`Rejected`) exist because only one of them is worth retrying unchanged. Slice 26 is not a small step: on
the Web, isomorphic-git's HTTP client needs a CORS proxy (Will runs `wacs-isomorphic-git-proxy` in a
sibling repository, so the proxy URL is configuration) and a credential callback fed from the host
`Credentials` service — tokens never live in project files; on desktop the transport is git2 behind the
same Rust commands as `TauriGitLive`. Until both halves exist there is no honest partial implementation.

## ProjectAdmin

`src/core/admin/projectAdmin.ts` provides `ProjectAdmin` over `FileSystem` for the jobs that act on a
project rather than its text; `AdminError` reasons are `NotFound`, `Invalid`, `Refused`, `Unsupported`,
`Io`.

- `rename(root, name)` renames the project as people see it, not the folder: a burrito's
  `identification.name` is rewritten for its default locale, and a project with no `metadata.json`
  records the name in `<root>/.sefer/project.json` rather than gaining metadata it never had.
- `metadata(root)` is `Option<BurritoMetadata>` — `None` when there is no file, `Invalid` when there is
  one and it is broken. `updateMetadata(root, patch)` shallow-merges top-level members and writes only
  through `decodeBurritoMetadata`, so an edit cannot leave the file invalid for the next reader.
- `delete(root, confirm)` asks first, always; `confirm` is a plain port (composition passes
  `Dialogs.confirm`) and a `false` answer is `Refused`.
- `export(root, "burrito", to)` copies the folder and returns the path written. `"usfm-zip"` is
  `Unsupported`: there is no archive dependency, and choosing one belongs to whoever needs the format.
