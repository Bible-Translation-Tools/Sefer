/**
 * The Git and Remote ports with every call in its repository's lane.
 *
 * Both hosts' Layers are wrapped here, once, by composition, so neither host
 * can forget a lane and no caller has to know lanes exist. A mutation runs in
 * the exclusive lane; a read that walks refs, the index or the log runs in the
 * shared one. `open` is left bare: it is what the lifecycle itself uses to look
 * at a root.
 *
 * A lifecycle refusal keeps each port's own error type — `GitError` `Refused`
 * ("Sefer declined before touching the repository"), `RemoteError` `Rejected`
 * — so no caller's error handling changes.
 */
import { Effect } from "effect";

import { RemoteError, type RemoteService } from "../remote/remote";
import { GitError, type GitService } from "./git";
import type { RepositoriesService, RepositoryError, WriteKind } from "./repository";

const asGit = (error: RepositoryError): GitError =>
  new GitError({ reason: "Refused", description: error.description });

const asRemote = (error: RepositoryError): RemoteError =>
  new RemoteError({ reason: "Rejected", description: error.description });

export const serialiseGit = (git: GitService, repositories: RepositoriesService): GitService => {
  const read = <A>(root: string, effect: Effect.Effect<A, GitError>) =>
    Effect.catchTag(repositories.shared(root, effect), "RepositoryError", (error) =>
      Effect.fail(asGit(error)),
    );
  const write = <A>(root: string, kind: WriteKind, effect: Effect.Effect<A, GitError>) =>
    Effect.catchTag(repositories.exclusive(root, kind, effect), "RepositoryError", (error) =>
      Effect.fail(asGit(error)),
    );
  return {
    open: git.open,
    init: (root) => write(root, "init", git.init(root)),
    commit: (repo, receipts, message, author) =>
      write(repo.root, "commit", git.commit(repo, receipts, message, author)),
    status: (repo) => read(repo.root, git.status(repo)),
    log: (repo, path) => read(repo.root, git.log(repo, path)),
    logFrom: (repo, ref) => read(repo.root, git.logFrom(repo, ref)),
    resolve: (repo, ref) => read(repo.root, git.resolve(repo, ref)),
    branch: (repo) => read(repo.root, git.branch(repo)),
    changedPathsBetween: (repo, from, to) =>
      read(repo.root, git.changedPathsBetween(repo, from, to)),
    show: (repo, rev, path) => read(repo.root, git.show(repo, rev, path)),
    // The list is read in the lane; each version's bytes are read later, by
    // id, which needs none.
    previousVersions: (repo, path) => read(repo.root, git.previousVersions(repo, path)),
  };
};

export const serialiseRemote = (
  remote: RemoteService,
  repositories: RepositoriesService,
): RemoteService => {
  const read = <A>(root: string, effect: Effect.Effect<A, RemoteError>) =>
    Effect.catchTag(repositories.shared(root, effect), "RepositoryError", (error) =>
      Effect.fail(asRemote(error)),
    );
  const write = <A>(root: string, kind: WriteKind, effect: Effect.Effect<A, RemoteError>) =>
    Effect.catchTag(repositories.exclusive(root, kind, effect), "RepositoryError", (error) =>
      Effect.fail(asRemote(error)),
    );
  return {
    // The folder does not exist yet; the lane is still the one a later open
    // of it will ask for, so a second clone into the same folder waits.
    clone: (url, into) => write(into, "clone", remote.clone(url, into)),
    attach: (repo, url) => write(repo.root, "attach", remote.attach(repo, url)),
    origin: (repo) => read(repo.root, remote.origin(repo)),
    fetch: (repo) => write(repo.root, "fetch", remote.fetch(repo)),
    pull: (repo) => write(repo.root, "pull", remote.pull(repo)),
    push: (repo) => write(repo.root, "push", remote.push(repo)),
    publish: (repo, target) => write(repo.root, "publish", remote.publish(repo, target)),
    moveBranch: (repo, branch, toCommit) =>
      write(repo.root, "move-branch", remote.moveBranch(repo, branch, toCommit)),
    abortMerge: (repo) => write(repo.root, "abort-merge", remote.abortMerge(repo)),
    progress: remote.progress,
  };
};
