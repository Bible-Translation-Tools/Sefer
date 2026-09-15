# Git, Remote, and project administration

Version control is a job someone asks for, never a side effect of editing. The source of truth is the
USFM bytes on disk; git records what Save already wrote.

## The port

`src/core/git/git.ts` defines `Git` (`Context.Service`) as the intersection of the user's jobs, not the
union of two libraries' APIs: `open`, `init`, `status`, `commit`, `log`, `logFrom`, `resolve`,
`branch`, `changedPathsBetween`, `show`, `previousVersions`. The four in the middle exist for the
sync surface — the cloud's side of a comparison, whether it exists at all, what to call the tracking
ref, and which paths differ between two revisions ([sync.md](sync.md)) — and BOTH hosts answer them
now. A `Repo` is just its work-tree `root`. Every method fails with `GitError`, whose `reason` is
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
- `TauriGitLive` (`src/platform/tauri/git.ts`) — `Layer<Git>` over one git2 command per port member in
  `src-tauri/src/git.rs`. It is translation only: it runs `repositoryPath` before every call and reads
  the Rust error's reason prefix, and Rust re-checks the path because that process can write anywhere
  the user can. The command table and the semantics both hosts agree on are in
  [desktop.md](desktop.md).

`gitContract(name, makeLayer, makeFileSystemLayer?)` in `src/core/git/contract.ts` is the acceptance
suite both must pass: init, empty status, a file written through `FileSystem`, a commit from one receipt,
then `log`, `show`, and `previousVersions` agreeing on it. It is exported and registered nowhere — the
tier each Layer belongs to is the registration site's decision. The desktop Layer cannot be registered
against it at all — `invoke` needs a Tauri runtime — so the same case, plus one per command, is
restated as Rust unit tests in `git.rs` and run by `cargo test`.

The one behaviour the two implementations reached differently and had to be brought together: the Web
layer refuses an empty receipt list, and `git_commit` did not — on an unborn HEAD it produced an empty
root commit. It refuses now, in the same words.

## Remote

`src/core/remote/remote.ts` defines the port — `attach`, `origin`, `fetch`, `pull`, `push`,
`publish`, `moveBranch`, `abortMerge`, and `progress(): Stream<Progress>`. The last two transfer
nothing: `moveBranch(repo, branch, toCommit)` points a branch at a commit and makes the work tree
match (Combine's base), and `abortMerge(repo)` throws away a half-finished merge (Resolve). They
live here rather than on `Git` because the sync surface is the only caller either will ever have,
and both refuse the same things on both hosts — a branch that is not checked out, and an abort with
nothing in progress. Its four reasons (`Unavailable`, `Unauthorized`, `Network`, `Rejected`)
exist because only one of them is worth retrying unchanged. Cloning is not a fifth method:
`cloneRepository(url, into)` in `src/core/remote/clone.ts` is `Git.init` → `attach` → `pull`, in core
because the ORDER is policy — a project on disk always knows where its bytes came from, even if the
pull fails half way.

`src/core/remote/gitea.ts` is the account half. WACS is a Gitea instance, so the flow is v1's:
`POST /api/v1/users/{user}/tokens` with HTTP Basic auth (plus `X-Gitea-OTP` when the account has two
factors) mints a token scoped to `SESSION_TOKEN_SCOPES` and named `sefer-<platform>-<date>`, and the
password is used for that one request and never stored. `login`, `logout`, `session`,
`listWritableRepos`, `listOwnedRepos`, `createRepo`, `getRepo`, `forkRepo`; `GiteaError` reasons are
`Unauthorized`, `OtpRequired`, `Network`, `Refused`, `Io`, and a 401 that mentions OTP is `OtpRequired`
rather than a wrong password. The session is a `Credential` (`username`, `token`, plus the token's name
and id) in the host `Credentials` service and nowhere else — never a project file. Core may not touch
`fetch`, so the transport arrives as the `HttpFetch` port and `GiteaLive({ fetch, platform })` is the
only thing needing a host. Repository listings resolve `/api/v1/user` first and pass `uid` to
`/repos/search`: without it the search is instance-wide and reads as empty for someone who owns repos.

`WebRemoteLive({ corsProxyUrl, requestedWith, giteaHost })` (`src/platform/web/remote.ts`) answers the
port with isomorphic-git's `http/web`. A browser cannot speak git smart-HTTP to Gitea directly — no CORS
headers — so every transfer goes through the proxy Will runs (`wacs-isomorphic-git-proxy`); with no
proxy configured every transfer refuses `Unavailable` and names the variable instead of failing later on
CORS. `onAuth` reads `Credentials.get(origin-of-the-remote-URL)`, one credential per Gitea instance.
`publish(repo, target)` takes a URL, or a `name`/`owner/name` on the configured host that it creates
first, then attaches, then pushes. `progress()` is a sliding `PubSub`, so a panel watching a transfer
can never hold it back. Desktop answers the same port through git2 in Rust (`src/platform/tauri`), where
no proxy is involved.

Configuration is `src/app/env.ts` only (see [configuration.md](configuration.md)):
`VITE_SEFER_GITEA_WEB_HOST`, `VITE_SEFER_GITEA_DESKTOP_HOST`, `VITE_SEFER_GIT_CORS_PROXY_URL`,
`VITE_SEFER_GIT_PROXY_X_REQUESTED_WITH`. The SURFACE is `/cloud` (`src/app/ui/cloud/`), which owns the state, the two clocks, the incoming
plan and the one right button — see [sync.md](sync.md). `src/app/ui/CloudPanel.tsx` keeps the
attach-and-publish half beside a project and shares the account half with it; the commands are
`remote.login`, `remote.pull`, `remote.push`. `RemoteUnavailableLive` remains for a
host with no transport.

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
- `export(root, format, to)` returns the path written: `"burrito"` copies the folder, `"usfm-zip"`
  writes `archive`'s bytes atomically, creating the parent folder if the person named one that does
  not exist yet. `archive(root)` is the same zip in memory, for a host with nowhere to put a file.
  `src/app/projectCommands.ts` chooses between them on `HostInfo.capabilities().nativeDisk`: with
  disk, `Dialogs.pickSaveFile` names a path and `export` writes it; without, the bytes go to a
  download.
