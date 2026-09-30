# Git, Remote, and project administration

Version control is a job someone asks for, never a side effect of editing. The source of truth is the
USFM bytes on disk; git records what Save already wrote.

## The port

`src/core/git/git.ts` defines `Git` (`Context.Service`) as the intersection of the user's jobs, not the
union of two libraries' APIs: `open`, `init`, `status`, `commit`, `mergeBase`, `log`, `logFrom`,
`resolve`, `branch`, `changedPathsBetween`, `show`, `previousVersions`. `mergeBase` and the four after
`log` exist for the sync surface — the commit two histories share, the cloud's side of a comparison,
whether it exists at all, what to call the tracking ref, and which paths differ between two revisions
([sync.md](sync.md)) — and BOTH hosts answer them. A repository Sefer creates starts on
`DEFAULT_BRANCH`, `"master"`, on both hosts; a clone takes whatever the server's HEAD names. A `Repo` is just its work-tree `root`. Every method fails with `GitError`, whose `reason` is
`NotARepository`, `Io`, `Conflict`, or `Refused` — a read that could not fail would force a host layer
to lie. `Version` pairs a `Commit` with `bytes()`, so a history list stays cheap and content is read
only when something displays or diffs it. Core names no library; `repositoryPath(root, path)` is the one
path rule the port owns — a saved path becomes repository-relative or `None`, and `None` means refuse.

## The receipts rule

`commit(repo, receipts, message, author, options?)` stages exactly the paths in the receipts it is
given, one at a time, and commits those. Nothing Sefer did not write can reach a commit — no untracked
scratch file, no editor backup, no `git add .`. The receipts come from three writers and no others:
SaveCoordinator (a book, plus the burrito's `metadata.json` its save refreshed, as `SaveReceipt.also`,
so the checksums and the text land in the same version), an import's arrival (intake, below), and
Combine's decision commit (the files it took from the other side). A receipt path outside `repo.root`
is `Refused` rather than quietly skipped, because that is a bug upstream.

An empty receipt list is `Refused`, since an empty commit records nothing true — with one exception.
`options.alsoParents` names further parents, which makes the commit a DECISION COMMIT: it joins two
histories, and its tree is the final text. With parents to join, an empty receipt list is allowed,
because the join is what it records ([sync.md](sync.md), Combine).

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

## One writer per repository

isomorphic-git has no locking, a Web page can have other tabs (and later a worker) on the same OPFS
repository, and libgit2 is reached from more than one window. So `src/core/git/repository.ts` owns
"may I touch `.git` now", per root:

- **Lanes.** Every mutation — `init`, `clone`, `commit`, `attach`, `fetch`, `fast-forward`, `receive`,
  `combine`, `push`, `publish`, `abort-merge` — runs in that root's EXCLUSIVE lane; every read that
  walks refs, the index or the log runs in its SHARED lane; reading an object by id needs neither.
  The lock is the `RepositoryLock` port: `WebLocksLive` (`src/platform/web/locks.ts`, one Web Lock
  named `sefer.git:<root>`, so two tabs serialise) in a browser or webview, `InProcessLockLive`
  elsewhere. A lane is re-entrant for the fiber holding it, because a transaction like Combine holds
  the exclusive lane and then commits through the port, and Web Locks would otherwise wait on
  themselves.
- **The lifecycle.** `step` is a pure transition over `absent | opening | ready | busy | unhealthy |
closing`, the order of its cases being the policy: closing refuses new work while running work
  ends; `unhealthy` (did not open, or a mutation stopped part-way) refuses everything but a repair,
  which today is only `abort-merge`; only `init` and `clone` may begin from `absent`.
- **Nobody calls it.** `src/core/git/serialised.ts` wraps both hosts' `Git` and `Remote` once, in
  composition (`laned()` in `src/app/services.ts`), so no host can forget a lane and no caller knows
  lanes exist. A lifecycle refusal keeps each port's own error — `GitError` `Refused`, `RemoteError`
  `Rejected` — so no caller's handling changes. The desktop side needs no Rust mutex: Tauri runs
  non-async commands one at a time.

`ProjectContext` closes the root's lifecycle when a project closes.

## Intake

Every project that arrives — a zip, a folder, a clone — leaves with a repository on one branch, and
`src/core/git/intake.ts` is the one path. An arriving `.git` keeps its history and loses everything
else a `.git` can carry: other remotes and their refs, credentials in a URL or a helper, hooks,
reflogs. That is an ALLOWLIST applied in place (`objects`, `refs/heads`, `refs/tags`, `HEAD`,
`shallow`, `packed-refs`, and a rewritten `config`), so whatever a future git adds is removed too. A
`.git` that cannot be adopted — a gitfile pointing elsewhere, a merge left half done, history that
cannot be read — is replaced by a fresh repository, and the files are kept either way.

Then `.sefer/` goes into `.git/info/exclude` (`excludeSeferFolder`, which a clone runs as well), so
the device's own corner — provenance, the name chosen here — never reaches a commit. Last comes the
ARRIVAL COMMIT: the files the import wrote, as receipts, when git sees any of them as new, authored
"Sefer" with an empty email because no person made it.

## Remote

`src/core/remote/remote.ts` defines the port — `clone`, `attach`, `attachAs`, `urlOf`, `origin`,
`probe`, `fetch`, `fetchRef`, `fastForward`, `push`, `publish`, `abortMerge`, and
`progress(): Stream<Progress>`. There is no `pull`. A receive is `fetch` and then
`fastForward(repo, to)`, which moves the checked-out branch forward only — it refuses a target the
branch is not an ancestor of — through a SAFE checkout, so a file with changes no commit holds
refuses the move before anything is written. `pull` merged, forced, and moved the files without the
Books; its replacement lives in core ([sync.md](sync.md), Receiving). `moveBranch` went with the
squash it served.

- `probe(url)` asks the server for its refs in one round trip and transfers nothing: the default
  branch, its head, whether the repository is empty. The check on open asks it first and fetches
  only when the head is not the one this device already holds.
- `push(repo, to?)` sends to `origin`, or to another remote by name. A per-ref refusal from the
  server is `Rejected` on both hosts; it never forces.
- `attachAs(repo, name, url)`, `urlOf(repo, name)` and `fetchRef(repo, from, into)` exist for a
  second remote and one named ref — today only suggested changes' own copy and a suggestion's head
  (below).
- `abortMerge(repo)` throws away a half-finished merge, and refuses when nothing is in progress,
  because it is a hard reset underneath. Sefer never starts a merge, so only another tool can leave
  one.

Its four reasons (`Unavailable`, `Unauthorized`, `Network`, `Rejected`) exist because only one of
them is worth retrying unchanged. Gitea answers a missing permission with either 401 or 403, and both
are `Unauthorized`, so the words say both.

`clone(url, into)` is a real clone — isomorphic-git's `clone` on the Web, git2's `RepoBuilder`
(`git_clone`) on desktop — and it checks out the branch the SERVER's HEAD symref names, so a
repository on `master` arrives on `master`. It used to be `Git.init` → `attach` → `pull`, and that
was wrong twice: the init chose `main` before the server was asked, and on the Web isomorphic-git's
pull then tried to merge into that unborn branch ("Could not find main", every browser download).
The URL is mapped to its content host first (`identityOf`, a proxy URL back to the server it
fronts), exactly as `attach` does, so `.git/config` names the server on both hosts and a project
moves between them unchanged; the Web's proxy is applied inside the HTTP client, per request. `cloneRepository(url, into, catalogueId?)` in
`src/core/remote/clone.ts` runs it and then appends a `remote` arrival to `.sefer/provenance.json`
with the URL as the caller gave it — after the clone, because git refuses a folder that is not
empty ([landing](landing.md) has the record and the index field it feeds).

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

`WebRemoteLive({ endpoint, appId })` (`src/platform/web/remote.ts`) answers the port with
isomorphic-git's `http/web`. A browser cannot speak git smart-HTTP to Gitea directly — no CORS headers,
and a managed challenge in front of the content host — so the Web build talks to ONE endpoint, which is
either a Gitea instance with nothing in front of it or the proxy Will runs (`wacs-isomorphic-git-proxy`)
where something is. The proxy answers on Gitea's own paths, so there is no `corsProxy` option and no URL
rewriting at transfer time: `attach` puts every remote URL on the endpoint, once, and what lands in
`.git/config` is therefore the door the project came through. Gitea's `clone_url` and the catalogue's
`repo_url` both name the content host directly, so re-basing at that single point is what stops a
browser build going straight at an origin it cannot reach. Desktop attaches what it was given — git2
can reach any host it likes. `onAuth` reads `Credentials.get(origin-of-the-remote-URL)`, one credential
per endpoint.

Anonymous is allowed, and that is a decision rather than an omission: WACS content is public, so fetch
and probe run without a credential on both hosts — the Web omits `onAuth`, and `git_fetch`/`git_probe`
take `Option<String>` and install no libgit2 credentials callback. Browsing the catalogue and
downloading a translation is how somebody gets started, and both layers used to refuse it before the
transport was ever reached. Push still insists, in the same words, because nobody pushes anonymously.
`publish(repo, target)` takes a URL, or a `name`/`owner/name` on the configured host that it creates
first, then attaches, then pushes. `progress()` is a sliding `PubSub`, so a panel watching a transfer
can never hold it back. Desktop answers the same port through git2 in Rust (`src/platform/tauri`), where
no proxy is involved.

Configuration is `src/app/env.ts` for the build's defaults and `src/app/endpoints.ts` for the
preference that may override them (see [configuration.md](configuration.md)):
`VITE_SEFER_CONTENT_HOST` (the identity: what `origin` names and a sign-in is filed under) and, on the
Web, `VITE_SEFER_WEB_TRANSPORT` (the proxy each host is reached through, applied at request time). The
Gitea API rides the same transport and sends the same `X-Requested-With` the transfers do; before that
it went direct and a successful sign-in was followed immediately by "Failed to fetch". The SURFACE is `/cloud` (`src/app/ui/cloud/`), which owns the state, the two clocks, the incoming
plan and the one right button — see [sync.md](sync.md). `src/app/ui/CloudPanel.tsx` keeps the
attach-and-publish half beside a project and shares the account half with it; the palette's
`remote.pull` and `remote.push` open `/cloud` rather than transferring, because the screen is where the
plan is shown first.

## Suggested changes

A translator who cannot write to the shared project sends to their OWN COPY of it (a Gitea fork) and
suggests those changes: one open pull request from that copy's branch, which later sends keep up to
date by themselves. Whoever can write to the shared project sees the open suggestions on `/cloud`, and
reviews one — Review against the shared project, with the suggestion's head
(`refs/pull/<n>/head`, fetched to `refs/remotes/origin/pull/<n>`) as the other side — or declines it
with a note. "Pull request" is Gitea's word and the code's; the screen says "suggested changes".

It is one topology among several, so it is built to come out. `src/core/remote/suggestions.ts` is its
own service (`Suggestions`, over the session `Gitea` keeps), `src/app/suggestions.ts` is the logic and
`src/app/ui/cloud/SuggestionsCard.tsx` the card, and they join the rest of Sefer at four one-line
seams:

1. `src/app/services.ts` registers `SuggestionsLive` and lists `Suggestions` in `Domain`;
2. `destination()` in `src/app/syncActions.ts` asks `sendingTo` where a send goes — the one place a
   send is pointed anywhere but `origin`;
3. `CloudScreen.tsx` mounts `SuggestionsCard`;
4. `ReviewPanel.tsx` reads `?pull=<n>` through `suggestionRef`.

Cut those and the dead-code gate (`pnpm deadcode`) reports the three files unused — checked on
2026-09-30 — and everything else sends to `origin` as before. Forks and pull requests are built but not
yet exercised against a second account.

## ProjectAdmin

`src/core/admin/projectAdmin.ts` provides `ProjectAdmin` over `FileSystem` for the jobs that act on a
project rather than its text; `AdminError` reasons are `NotFound`, `Invalid`, `Refused`, `Unsupported`,
`Io`.

- `rename(root, name)` renames the project as THIS DEVICE shows it, not the folder and not its
  metadata: the name goes in `<root>/.sefer/project.json`, which never reaches a commit. A shared
  project's `identification.name` belongs to everyone who receives it, and a rename on one laptop
  used to rewrite it for all of them.
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
