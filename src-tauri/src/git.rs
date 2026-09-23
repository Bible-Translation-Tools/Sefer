//! The desktop half of the `Git` and `Remote` ports, over git2 (libgit2).
//!
//! Why native git rather than isomorphic-git on desktop: real performance on
//! a project with sixty-six books of history, and one implementation of merge
//! and packfile behaviour instead of two. The Web host keeps isomorphic-git
//! because a browser has no other option.
//!
//! The command set is the intersection of what the ports name — not libgit2's
//! surface. Each command takes the work tree root as a plain path and returns
//! a serialisable mirror of the port's types; the paths a caller passes are
//! repository-relative and are re-checked here, because a receipt path that
//! escaped the project is a bug we refuse rather than commit.

use std::path::{Component, Path};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use git2::{
    build::CheckoutBuilder, Cred, Delta, ErrorCode, FetchOptions, ObjectType, Oid, PushOptions,
    RemoteCallbacks, Repository, RepositoryInitOptions, RepositoryState, ResetType, Signature,
    Sort, Status, StatusOptions,
};
use serde::Serialize;

use crate::errors::{fail, AUTH_FAILED, CONFLICT, IO, NOT_A_REPOSITORY, OFFLINE, REFUSED, REJECTED};

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

#[derive(Serialize)]
pub struct GitCommit {
    pub id: String,
    pub message: String,
    pub author_name: String,
    pub author_email: String,
    /// Milliseconds since the epoch — the unit the port's `Commit.at` uses, so
    /// the TS side never has to remember libgit2 counts seconds.
    pub at: i64,
}

#[derive(Serialize)]
pub struct GitChangedPath {
    pub path: String,
    /// One of `added` | `modified` | `deleted` | `untracked`.
    pub kind: String,
}

/// Mirrors the `Remote` port's `Progress`. `total` is `None` until the far
/// side has said how much there is, which is most of a fetch's first phase.
#[derive(Serialize)]
pub struct GitProgress {
    pub phase: String,
    pub loaded: usize,
    pub total: Option<usize>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn open_repo(root: &str) -> Result<Repository, String> {
    Repository::open(root).map_err(|error| fail(NOT_A_REPOSITORY, error.message()))
}

fn io(error: git2::Error) -> String {
    fail(IO, error.message())
}

/// The libgit2-prose-to-reason classifier, ported from the v1 app's
/// `classify_remote_transport_failure`. libgit2 reports transport trouble as
/// free text with no distinguishing error code, so substring matching is the
/// only thing available — but it happens exactly once, here.
fn classify_transport(message: &str) -> &'static str {
    let text = message.to_ascii_lowercase();
    if text.contains("non-fast-forward")
        || text.contains("fetch first")
        || text.contains("failed to push some refs")
        || text.contains("push rejected")
        || text.contains("cannot push")
    {
        return REJECTED;
    }
    if text.contains("401")
        || text.contains("403")
        || text.contains("authentication")
        || text.contains("authorization")
        || text.contains("forbidden")
        || text.contains("access denied")
        || text.contains("credentials")
    {
        return AUTH_FAILED;
    }
    if text.contains("offline")
        || text.contains("network")
        || text.contains("timed out")
        || text.contains("could not resolve host")
        || text.contains("connection")
        || text.contains("dns")
        || text.contains("failed to connect")
    {
        return OFFLINE;
    }
    IO
}

fn transport_failure(error: git2::Error) -> String {
    let message = error.message().to_string();
    fail(classify_transport(&message), message)
}

/// Token authentication, ported from v1's `remote_callbacks_for_token`.
/// libgit2 asks for a credential per connection attempt; a Gitea/WACS personal
/// access token is presented as HTTP basic userpass, which is what the server
/// expects. No SSH agent and no key file: Sefer authenticates with a token or
/// not at all.
///
/// `None` is ANONYMOUS, and that is an ordinary case rather than a missing
/// value. WACS content is public: browsing the catalogue and cloning a
/// translation is how somebody gets started, and demanding a sign-in first
/// turns the front door into a wall. So no credentials callback is installed
/// at all — libgit2 asks only when the server challenges, and a callback that
/// has nothing to answer with reports a public fetch as an auth failure.
/// Push is the other way round and always carries one; `git_push` says so in
/// its signature.
fn remote_callbacks(credential: Option<(&str, &str)>) -> RemoteCallbacks<'static> {
    let mut callbacks = RemoteCallbacks::new();
    if let Some((username, token)) = credential {
        let username = username.to_string();
        let token = token.to_string();
        callbacks.credentials(move |_url, _username_from_url, _allowed| {
            Cred::userpass_plaintext(&username, &token)
        });
    }
    callbacks
}

/// Both halves or neither. A half-filled pair is a bug on the TS side rather
/// than a reason to try a nameless token against the server.
fn credential_pair<'a>(
    username: &'a Option<String>,
    token: &'a Option<String>,
) -> Option<(&'a str, &'a str)> {
    match (username, token) {
        (Some(username), Some(token)) => Some((username.as_str(), token.as_str())),
        _ => None,
    }
}

/// Repository-relative or nothing.
///
/// The TS adapter has already run core's `repositoryPath`, so this is the
/// second line of defence rather than the rule's home — but it is the line
/// that matters, because this process can write anywhere the user can and a
/// staged `../../.ssh/id_rsa` would be a real hole.
fn relative_path(path: &str) -> Result<&Path, String> {
    let candidate = Path::new(path);
    if candidate.is_absolute() {
        return Err(fail(REFUSED, format!("absolute path: {path}")));
    }
    for component in candidate.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            _ => return Err(fail(REFUSED, format!("path escapes the repository: {path}"))),
        }
    }
    Ok(candidate)
}

fn commit_of(commit: &git2::Commit<'_>) -> GitCommit {
    let author = commit.author();
    GitCommit {
        id: commit.id().to_string(),
        message: commit.message().unwrap_or("").trim_end().to_string(),
        author_name: author.name().unwrap_or("Unknown").to_string(),
        author_email: author.email().unwrap_or("").to_string(),
        at: commit.time().seconds() * 1000,
    }
}

/// The name of the branch HEAD is on.
///
/// An unborn HEAD still has a symbolic target (whatever `init` set), and that
/// is the branch a first push should create — so it is answered rather than
/// refused. A detached HEAD genuinely has no branch, and every caller of this
/// wants one, so that is a `Conflict`.
fn current_branch(repo: &Repository) -> Result<String, String> {
    match repo.head() {
        Ok(head) => match head.shorthand() {
            Some(name) => Ok(name.to_string()),
            None => Err(fail(CONFLICT, "HEAD is detached; no branch to use")),
        },
        Err(error) if error.code() == ErrorCode::UnbornBranch => {
            let reference = repo
                .find_reference("HEAD")
                .map_err(|error| fail(CONFLICT, error.message()))?;
            match reference.symbolic_target() {
                Some(target) => Ok(target.trim_start_matches("refs/heads/").to_string()),
                None => Ok("main".to_string()),
            }
        }
        Err(error) => Err(fail(CONFLICT, error.message())),
    }
}

/// The identity a commit is recorded under, in ONE function.
///
/// Sefer has no author setting yet — `src/app/commands.ts` passes the fixed
/// "Sefer <sefer@localhost>" the Web host also uses. When an identity setting
/// arrives (a translator's own name on their own versions), this is the only
/// place that has to learn about it, and a caller that sends blanks already
/// gets the default rather than a libgit2 error about an empty name.
fn author_signature(name: &str, email: &str) -> Result<Signature<'static>, String> {
    let name = if name.trim().is_empty() {
        DEFAULT_AUTHOR_NAME
    } else {
        name
    };
    let email = if email.trim().is_empty() {
        DEFAULT_AUTHOR_EMAIL
    } else {
        email
    };
    Signature::now(name, email).map_err(io)
}

const DEFAULT_AUTHOR_NAME: &str = "Sefer";
const DEFAULT_AUTHOR_EMAIL: &str = "sefer@localhost";

/// The blob id of `path` in a commit's tree, or `None` when the commit does
/// not contain it. This is how the per-file history is computed: a commit is
/// part of a file's history when its blob differs from every parent's.
fn blob_at(commit: &git2::Commit<'_>, path: &Path) -> Option<Oid> {
    let tree = commit.tree().ok()?;
    let entry = tree.get_path(path).ok()?;
    if entry.kind() == Some(ObjectType::Blob) {
        Some(entry.id())
    } else {
        None
    }
}

fn touched(commit: &git2::Commit<'_>, path: &Path) -> bool {
    let here = blob_at(commit, path);
    if commit.parent_count() == 0 {
        return here.is_some();
    }
    commit
        .parents()
        .any(|parent| blob_at(&parent, path) != here)
}

fn history(root: &str, path: Option<String>) -> Result<Vec<GitCommit>, String> {
    let repo = open_repo(root)?;
    let filter = match path.as_deref() {
        Some(value) => Some(relative_path(value)?.to_path_buf()),
        None => None,
    };

    let mut walk = repo.revwalk().map_err(io)?;
    // An unborn HEAD is an empty history, not a failure: a project that has
    // been initialised but never committed is a normal state in Sefer.
    if walk.push_head().is_err() {
        return Ok(Vec::new());
    }
    walk.set_sorting(Sort::TIME).map_err(io)?;

    let mut out = Vec::new();
    for oid in walk {
        let commit = repo.find_commit(oid.map_err(io)?).map_err(io)?;
        match filter.as_deref() {
            Some(candidate) if !touched(&commit, candidate) => continue,
            _ => out.push(commit_of(&commit)),
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// The Git port
// ---------------------------------------------------------------------------

/// Fails with `NotARepository` rather than creating one — the port promises
/// that, because "open" is how a caller finds out whether history exists.
#[tauri::command]
pub fn git_open(root: String) -> Result<(), String> {
    open_repo(&root).map(|_| ())
}

/// Idempotent: initialising a repository that already exists opens it.
#[tauri::command]
pub fn git_init(root: String) -> Result<(), String> {
    if Repository::open(&root).is_ok() {
        return Ok(());
    }
    std::fs::create_dir_all(&root).map_err(|error| fail(IO, error.to_string()))?;
    let mut options = RepositoryInitOptions::new();
    options.initial_head("main");
    Repository::init_opts(&root, &options)
        .map(|_| ())
        .map_err(io)
}

#[tauri::command]
pub fn git_status(root: String) -> Result<Vec<GitChangedPath>, String> {
    let repo = open_repo(&root)?;
    let mut options = StatusOptions::new();
    options.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut options)).map_err(io)?;

    let mut out = Vec::new();
    for entry in statuses.iter() {
        let Some(path) = entry.path() else { continue };
        let flags = entry.status();
        // Order matters: a path can carry several bits at once (staged as new
        // and modified again in the work tree), and the port names one kind.
        let kind = if flags.intersects(Status::INDEX_NEW) {
            "added"
        } else if flags.intersects(Status::WT_NEW) {
            "untracked"
        } else if flags.intersects(Status::INDEX_DELETED | Status::WT_DELETED) {
            "deleted"
        } else {
            "modified"
        };
        out.push(GitChangedPath {
            path: path.to_string(),
            kind: kind.to_string(),
        });
    }
    Ok(out)
}

/// Stages exactly `paths` and commits them.
///
/// Nothing that Save did not write reaches a commit: there is no `add_all`
/// here, deliberately, so a stray editor backup or an unrelated dirty file
/// stays out of the history. A path that no longer exists on disk is staged as
/// a deletion, which is how a Save that removed a book is recorded.
///
/// Returns the existing HEAD id unchanged when the staged tree matches it —
/// committing nothing is not an error, and an empty commit would pollute the
/// history a translator reads.
///
/// An EMPTY receipt list is a different thing and is `Refused`, exactly as the
/// Web layer refuses it: "commit nothing" is a bug upstream, and on an unborn
/// HEAD it would otherwise have produced an empty root commit — a version in
/// the timeline containing no scripture at all.
#[tauri::command]
pub fn git_commit(
    root: String,
    paths: Vec<String>,
    message: String,
    author_name: String,
    author_email: String,
) -> Result<String, String> {
    if paths.is_empty() {
        return Err(fail(
            REFUSED,
            "nothing to commit: Save produced no receipts",
        ));
    }
    let repo = open_repo(&root)?;
    let mut index = repo.index().map_err(io)?;

    for raw in &paths {
        let relative = relative_path(raw)?;
        if Path::new(&root).join(relative).exists() {
            index.add_path(relative).map_err(io)?;
        } else {
            index.remove_path(relative).map_err(io)?;
        }
    }
    index.write().map_err(io)?;

    let tree_oid = index.write_tree().map_err(io)?;
    let tree = repo.find_tree(tree_oid).map_err(io)?;
    let parent = repo
        .head()
        .ok()
        .and_then(|head| head.target())
        .and_then(|oid| repo.find_commit(oid).ok());

    if let Some(existing) = &parent {
        if existing.tree_id() == tree_oid {
            return Ok(existing.id().to_string());
        }
    } else if tree.is_empty() {
        // No parent AND nothing in the tree: every named path was a deletion
        // of something never recorded. A root commit here would be an empty
        // first version, which records nothing and misleads the history.
        return Err(fail(
            REFUSED,
            "nothing to commit: none of the saved paths exist",
        ));
    }

    let signature = author_signature(&author_name, &author_email)?;
    let parents: Vec<&git2::Commit<'_>> = parent.iter().collect();
    let oid = repo
        .commit(
            Some("HEAD"),
            &signature,
            &signature,
            &message,
            &tree,
            &parents,
        )
        .map_err(io)?;
    Ok(oid.to_string())
}

/// Newest first. With `path`, only the commits that changed that path.
#[tauri::command]
pub fn git_log(root: String, path: Option<String>) -> Result<Vec<GitCommit>, String> {
    history(&root, path)
}

/// The per-file history, newest first. Same walk as `git_log` with a path —
/// named separately because it is what the port's `previousVersions` means,
/// and a reader of either side should not have to know they coincide.
#[tauri::command]
pub fn git_previous_versions(root: String, path: String) -> Result<Vec<GitCommit>, String> {
    history(&root, Some(path))
}

/// The bytes of `path` at `rev`, where `rev` is a ref name or a commit id.
///
/// Bytes cross the IPC boundary as a JSON number array, which costs several
/// times the file's size. That is acceptable because this is the history-view
/// path — one file at a time, on demand — and never the editing path.
#[tauri::command]
pub fn git_show(root: String, rev: String, path: String) -> Result<Vec<u8>, String> {
    let repo = open_repo(&root)?;
    let relative = relative_path(&path)?;
    let object = repo
        .revparse_single(&rev)
        .map_err(|error| fail(CONFLICT, error.message()))?;
    let commit = object
        .peel_to_commit()
        .map_err(|error| fail(CONFLICT, error.message()))?;
    let tree = commit.tree().map_err(io)?;
    let entry = tree
        .get_path(relative)
        .map_err(|error| fail(CONFLICT, error.message()))?;
    let blob = entry
        .to_object(&repo)
        .map_err(io)?
        .into_blob()
        .map_err(|_| fail(CONFLICT, format!("{path} is not a file at {rev}")))?;
    Ok(blob.content().to_vec())
}

// ---------------------------------------------------------------------------
// The four sync reads
//
// The cloud's side of a comparison, worked out entirely from the object
// database: after a fetch the remote's commits are already local, so which
// books and chapters would change can be shown BEFORE a single byte of the
// work tree moves. None of these four touches a file.
// ---------------------------------------------------------------------------

/// Commits reachable from `rev`, newest first — `git_log` for a ref that is
/// not HEAD. The sync surface reads `refs/remotes/origin/<branch>` with it.
///
/// A rev that names nothing is an EMPTY history, not a failure: a project
/// attached to a repository nobody has pushed to yet has no tracking ref, and
/// that is the ordinary "unpublished" state.
#[tauri::command]
pub fn git_log_from(root: String, rev: String) -> Result<Vec<GitCommit>, String> {
    let repo = open_repo(&root)?;
    let Some(start) = resolve_commit(&repo, &rev)? else {
        return Ok(Vec::new());
    };

    let mut walk = repo.revwalk().map_err(io)?;
    walk.push(start).map_err(io)?;
    walk.set_sorting(Sort::TIME).map_err(io)?;

    let mut out = Vec::new();
    for oid in walk {
        let commit = repo.find_commit(oid.map_err(io)?).map_err(io)?;
        out.push(commit_of(&commit));
    }
    Ok(out)
}

/// `rev` as a commit id, or `None` when the repository has no such rev.
///
/// `None` is an ANSWER, not a failure — see `GitService.resolve`. Only "there
/// is no such thing" answers `None`; a broken object database still fails.
#[tauri::command]
pub fn git_resolve_ref(root: String, rev: String) -> Result<Option<String>, String> {
    let repo = open_repo(&root)?;
    Ok(resolve_commit(&repo, &rev)?.map(|oid| oid.to_string()))
}

/// The branch HEAD is on, or `None` on a detached HEAD.
///
/// An unborn HEAD still answers with a name, deliberately: it is the branch a
/// first push must create, and the Web layer's `git.currentBranch` answers the
/// same way for a freshly initialised repository. Only a detached HEAD has
/// genuinely no branch.
#[tauri::command]
pub fn git_current_branch(root: String) -> Result<Option<String>, String> {
    let repo = open_repo(&root)?;
    if repo.head_detached().map_err(io)? {
        return Ok(None);
    }
    Ok(Some(current_branch(&repo)?))
}

/// Repository-relative paths whose content differs between two revs, with the
/// kind seen FROM `from` TO `to`.
///
/// Rename detection is deliberately off: `diff_find_similar` would report a
/// moved book as one rename, and the Web layer — which compares blob ids in a
/// tree walk — reports it as a delete and an add. The two hosts must agree, and
/// the plan a translator reads is about paths, not about libgit2's heuristics.
#[tauri::command]
pub fn git_changed_paths_between(
    root: String,
    from: String,
    to: String,
) -> Result<Vec<GitChangedPath>, String> {
    let repo = open_repo(&root)?;
    let before = tree_at(&repo, &from)?;
    let after = tree_at(&repo, &to)?;
    let diff = repo
        .diff_tree_to_tree(Some(&before), Some(&after), None)
        .map_err(io)?;

    let mut out = Vec::new();
    for delta in diff.deltas() {
        let (kind, file) = match delta.status() {
            Delta::Added => ("added", delta.new_file()),
            Delta::Deleted => ("deleted", delta.old_file()),
            _ => ("modified", delta.new_file()),
        };
        let Some(path) = file.path().and_then(|path| path.to_str()) else {
            continue;
        };
        out.push(GitChangedPath {
            path: path.to_string(),
            kind: kind.to_string(),
        });
    }
    Ok(out)
}

/// `rev` as a commit id, or `None` when nothing by that name exists.
fn resolve_commit(repo: &Repository, rev: &str) -> Result<Option<Oid>, String> {
    match repo.revparse_single(rev) {
        Ok(object) => Ok(Some(
            object
                .peel_to_commit()
                .map_err(|error| fail(CONFLICT, error.message()))?
                .id(),
        )),
        Err(error)
            if error.code() == ErrorCode::NotFound || error.code() == ErrorCode::InvalidSpec =>
        {
            Ok(None)
        }
        Err(error) => Err(fail(CONFLICT, error.message())),
    }
}

fn tree_at<'repo>(repo: &'repo Repository, rev: &str) -> Result<git2::Tree<'repo>, String> {
    let oid = resolve_commit(repo, rev)?
        .ok_or_else(|| fail(CONFLICT, format!("{rev} names no commit")))?;
    repo.find_commit(oid)
        .map_err(io)?
        .tree()
        .map_err(|error| fail(CONFLICT, error.message()))
}

// ---------------------------------------------------------------------------
// The two work-tree moves the sync surface needs
//
// Both are local — no transport, no credential — but they exist FOR the sync
// surface: Combine is a branch move plus a replay, and Resolve is an abort.
// They sit on the `Remote` port because that is where the sync surface reaches
// for them; they are here because git2 is what performs them.
// ---------------------------------------------------------------------------

/// Points `branch` at `to_commit` and makes the work tree match.
///
/// This is half of Combine: the shared project's versions become the base. It
/// is a FORCED checkout — anything uncommitted in the work tree is lost — so a
/// caller must have committed (or read out) the work it intends to replay
/// before calling this. Combine does exactly that, which is why it is safe
/// there and nowhere else.
///
/// The branch must be the one HEAD is on. Moving a branch out from under a
/// checked-out different branch is a foot-gun with no caller, so it is refused.
#[tauri::command]
pub fn git_move_branch(root: String, branch: String, to_commit: String) -> Result<(), String> {
    let repo = open_repo(&root)?;
    let target = resolve_commit(&repo, &to_commit)?
        .ok_or_else(|| fail(CONFLICT, format!("{to_commit} names no commit")))?;

    if repo.state() != RepositoryState::Clean {
        return Err(fail(
            CONFLICT,
            "a merge or rebase is in progress; finish or abort it first",
        ));
    }
    let head = current_branch(&repo)?;
    if head != branch {
        return Err(fail(
            CONFLICT,
            format!(
                "HEAD is on {head}, not {branch}; cannot move a branch that is not checked out"
            ),
        ));
    }

    let reference = format!("refs/heads/{branch}");
    repo.reference(&reference, target, true, "sefer: move branch")
        .map_err(io)?;
    repo.set_head(&reference).map_err(io)?;
    repo.checkout_head(Some(CheckoutBuilder::new().force()))
        .map_err(io)?;
    Ok(())
}

/// Throws away a half-finished merge: the work tree goes back to HEAD and the
/// merge state (`MERGE_HEAD`, `MERGE_MSG`) is cleared.
///
/// Refused when nothing is in progress, and that refusal matters: a hard reset
/// on a clean repository would silently discard a translator's unsaved morning
/// rather than undoing a transfer.
#[tauri::command]
pub fn git_abort_merge(root: String) -> Result<(), String> {
    let repo = open_repo(&root)?;
    if repo.state() == RepositoryState::Clean {
        return Err(fail(CONFLICT, "no merge is in progress"));
    }
    let head = repo
        .head()
        .map_err(|error| fail(CONFLICT, error.message()))?
        .peel(ObjectType::Commit)
        .map_err(|error| fail(CONFLICT, error.message()))?;
    repo.reset(&head, ResetType::Hard, None).map_err(io)?;
    repo.cleanup_state().map_err(io)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// The Remote port
// ---------------------------------------------------------------------------

/// Records `url` as `name`'s URL, creating the remote when it is absent.
/// Transfers nothing — this is the port's `attach`.
#[tauri::command]
pub fn git_ensure_remote(root: String, name: String, url: String) -> Result<(), String> {
    let repo = open_repo(&root)?;
    // Bound to a local: the `Result<Remote<'_>, _>` the match scrutinises
    // borrows `repo`, and a tail expression would outlive it.
    let outcome = match repo.find_remote(&name) {
        Ok(_) => repo.remote_set_url(&name, &url).map_err(io),
        Err(error) if error.code() == ErrorCode::NotFound => {
            repo.remote(&name, &url).map(|_| ()).map_err(io)
        }
        Err(error) => Err(io(error)),
    };
    outcome
}

/// The URL recorded for `name`, or `None` when the repository has no such
/// remote. The TS side needs it to find the credential: a token belongs to a
/// Gitea instance, not to one repository, so the URL's origin is the key.
#[tauri::command]
pub fn git_remote_url(root: String, name: String) -> Result<Option<String>, String> {
    let repo = open_repo(&root)?;
    let outcome = match repo.find_remote(&name) {
        Ok(remote) => Ok(remote.url().map(|url| url.to_string())),
        Err(error) if error.code() == ErrorCode::NotFound => Ok(None),
        Err(error) => Err(io(error)),
    };
    outcome
}

fn fetch_branch(
    repo: &Repository,
    remote_name: &str,
    branch: &str,
    credential: Option<(&str, &str)>,
) -> Result<GitProgress, String> {
    let mut remote = repo
        .find_remote(remote_name)
        .map_err(|error| fail(CONFLICT, error.message()))?;
    let refspec = format!("+refs/heads/{branch}:refs/remotes/{remote_name}/{branch}");

    let mut options = FetchOptions::new();
    options.remote_callbacks(remote_callbacks(credential));
    remote
        .fetch(&[refspec.as_str()], Some(&mut options), None)
        .map_err(transport_failure)?;

    let stats = remote.stats();
    Ok(GitProgress {
        phase: "fetch".to_string(),
        loaded: stats.received_objects(),
        total: Some(stats.total_objects()),
    })
}

#[tauri::command]
pub fn git_fetch(
    root: String,
    remote: String,
    username: Option<String>,
    token: Option<String>,
) -> Result<GitProgress, String> {
    let repo = open_repo(&root)?;
    let branch = current_branch(&repo)?;
    fetch_branch(&repo, &remote, &branch, credential_pair(&username, &token))
}

/// Fetch, then fast-forward the current branch onto the remote's tip.
///
/// Sefer deliberately does not merge here. A three-way merge of USFM is a
/// decision a translator has to make with the text in front of them, so a
/// divergent history is reported as `Conflict` and the sync surface asks —
/// rather than producing conflict markers inside scripture.
#[tauri::command]
pub fn git_pull(
    root: String,
    remote: String,
    username: Option<String>,
    token: Option<String>,
) -> Result<GitProgress, String> {
    let repo = open_repo(&root)?;
    let branch = current_branch(&repo)?;
    let transferred = fetch_branch(&repo, &remote, &branch, credential_pair(&username, &token))?;

    let remote_ref = format!("refs/remotes/{remote}/{branch}");
    let target = match repo.find_reference(&remote_ref) {
        Ok(reference) => reference.target(),
        Err(error) if error.code() == ErrorCode::NotFound => None,
        Err(error) => return Err(io(error)),
    };
    let Some(target) = target else {
        // Nothing on the remote for this branch. The fetch succeeded, so this
        // is "up to date with an empty remote", not a failure.
        return Ok(GitProgress {
            phase: "up-to-date".to_string(),
            loaded: transferred.loaded,
            total: transferred.total,
        });
    };

    let fetched = repo.find_annotated_commit(target).map_err(io)?;
    let (analysis, _) = repo.merge_analysis(&[&fetched]).map_err(io)?;

    if analysis.is_up_to_date() {
        return Ok(GitProgress {
            phase: "up-to-date".to_string(),
            loaded: transferred.loaded,
            total: transferred.total,
        });
    }
    if !analysis.is_fast_forward() && !analysis.is_unborn() {
        return Err(fail(
            CONFLICT,
            format!("local {branch} has diverged from {remote}/{branch}"),
        ));
    }

    let reference = format!("refs/heads/{branch}");
    repo.reference(&reference, target, true, "sefer pull: fast-forward")
        .map_err(io)?;
    repo.set_head(&reference).map_err(io)?;
    repo.checkout_head(Some(CheckoutBuilder::new().force()))
        .map_err(io)?;

    Ok(GitProgress {
        phase: "fast-forward".to_string(),
        loaded: transferred.loaded,
        total: transferred.total,
    })
}

/// Pushes `branch` (HEAD's branch when absent) to `remote`.
///
/// A non-fast-forward is `Rejected`, not `Io`: it is the one transport failure
/// with a specific remedy (pull first), and the sync surface says so.
///
/// Unlike fetch and pull this takes a credential rather than an `Option`:
/// nobody pushes anonymously, so a missing sign-in is refused on the TS side
/// before it reaches here rather than being discovered as a 401 mid-transfer.
#[tauri::command]
pub fn git_push(
    root: String,
    remote: String,
    branch: Option<String>,
    username: String,
    token: String,
) -> Result<GitProgress, String> {
    let repo = open_repo(&root)?;
    let branch = match branch {
        Some(name) => name,
        None => current_branch(&repo)?,
    };
    let mut handle = repo
        .find_remote(&remote)
        .map_err(|error| fail(CONFLICT, error.message()))?;

    // libgit2 reports push progress through a callback rather than in the
    // stats it keeps for a fetch, so the last report is latched here.
    let sent = Arc::new(AtomicUsize::new(0));
    let expected = Arc::new(AtomicUsize::new(0));
    let mut callbacks = remote_callbacks(Some((&username, &token)));
    {
        let sent = Arc::clone(&sent);
        let expected = Arc::clone(&expected);
        callbacks.push_transfer_progress(move |current, total, _bytes| {
            sent.store(current, Ordering::Relaxed);
            expected.store(total, Ordering::Relaxed);
        });
    }

    let mut options = PushOptions::new();
    options.remote_callbacks(callbacks);
    let refspec = format!("refs/heads/{branch}:refs/heads/{branch}");
    handle
        .push(&[refspec.as_str()], Some(&mut options))
        .map_err(transport_failure)?;

    Ok(GitProgress {
        phase: "push".to_string(),
        loaded: sent.load(Ordering::Relaxed),
        total: Some(expected.load(Ordering::Relaxed)),
    })
}
