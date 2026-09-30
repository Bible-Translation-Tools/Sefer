/**
 * Intake: every project that arrives — a zip, a folder, a clone — leaves with
 * a repository, on one branch, whose first commit covers exactly what arrived.
 *
 * A zip or folder that carries its own `.git` keeps its history and loses
 * everything else a `.git` can carry: remotes and their refs (the friend's
 * remote is not ours), credentials in a URL or a helper, hooks, reflogs. That
 * is an ALLOWLIST applied in place — anything not named here is removed,
 * including whatever a future git version adds — and a fresh config. One that
 * cannot be adopted (a pointer to a repository elsewhere, a merge left half
 * done, history that cannot be read) is replaced by a fresh one, and the
 * files are kept either way.
 *
 * Then `.sefer/` is excluded, so this device's own corner (provenance, the
 * name chosen here) never reaches a commit, and the arrival is recorded:
 * the files the import wrote, as receipts, when git sees any of them as new.
 *
 * Pure over the ports: the FileSystem for the allowlist, `Git` for the rest.
 */
import { Effect, FileSystem, Option, type PlatformError } from "effect";

import { joinPath } from "../fileSystem/path";
import { Observability } from "../observability";
import { Git, GitError, type Author, type CommitId, type Repo } from "./git";
import { Repositories } from "./repository";

/** Why an arriving `.git` was not adopted. */
export type AdoptFallback = "gitfile" | "in-progress" | "unreadable";

export interface IntakeResult {
  readonly repo: Repo;
  /** True when the arriving history was kept. */
  readonly adopted: boolean;
  /** Why an arriving `.git` was replaced by a fresh one, when it was. */
  readonly fallback: AdoptFallback | undefined;
  /** The arrival commit, when the files were not already what HEAD holds. */
  readonly arrival: CommitId | undefined;
}

/**
 * What survives adoption at the top of `.git`; `config` is rewritten.
 *
 * `index` stays: it is the repository's own record of what HEAD holds, and
 * without it every file reads as changed — on the Web, where a commit is
 * built from the index, the arrival then re-recorded the whole tree as a
 * commit identical to HEAD.
 */
const KEEP = new Set(["objects", "refs", "HEAD", "shallow", "packed-refs", "config", "index"]);

/** What survives under `refs/`: branches and tags, never another remote's refs. */
const KEEP_REFS = new Set(["heads", "tags"]);

/** A merge, rebase, cherry-pick or revert someone left half done. */
const IN_PROGRESS = [
  "MERGE_HEAD",
  "rebase-merge",
  "rebase-apply",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
];

/**
 * isomorphic-git's own `init` config, which libgit2 opens as well: nothing in
 * it names a remote, a credential, a hook path or a user.
 */
const CONFIG =
  "[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n\tlogallrefupdates = true\n\tsymlinks = false\n\tignorecase = true\n";

const EXCLUDE = ".sefer/";

/** `packed-refs` without another remote's refs, and without the peel lines that followed them. */
const withoutRemoteRefs = (text: string): string => {
  const out: string[] = [];
  let dropping = false;
  for (const line of text.split("\n")) {
    if (line.startsWith("^")) {
      if (!dropping) out.push(line);
      continue;
    }
    dropping = / refs\/(?!heads\/|tags\/)/u.test(line);
    if (!dropping) out.push(line);
  }
  return out.join("\n");
};

/**
 * Applies the allowlist to `root/.git` in place. `None` when it is adoptable
 * and adopted; the reason otherwise, having changed nothing that matters
 * (the caller replaces the whole `.git`).
 */
const adopt = (
  fileSystem: FileSystem.FileSystem,
  gitDir: string,
): Effect.Effect<Option.Option<AdoptFallback>, PlatformError.PlatformError> =>
  Effect.gen(function* () {
    if ((yield* fileSystem.stat(gitDir)).type !== "Directory") return Option.some("gitfile");
    for (const marker of IN_PROGRESS)
      if (yield* fileSystem.exists(joinPath(gitDir, marker))) return Option.some("in-progress");

    for (const entry of yield* fileSystem.readDirectory(gitDir))
      if (!KEEP.has(entry))
        yield* fileSystem.remove(joinPath(gitDir, entry), { recursive: true, force: true });
    const refs = joinPath(gitDir, "refs");
    if (yield* fileSystem.exists(refs))
      for (const entry of yield* fileSystem.readDirectory(refs))
        if (!KEEP_REFS.has(entry))
          yield* fileSystem.remove(joinPath(refs, entry), { recursive: true, force: true });
    const packed = joinPath(gitDir, "packed-refs");
    if (yield* fileSystem.exists(packed))
      yield* fileSystem.writeFileString(
        packed,
        withoutRemoteRefs(yield* fileSystem.readFileString(packed)),
      );
    yield* fileSystem.writeFileString(joinPath(gitDir, "config"), CONFIG);
    return Option.none();
  });

/** `.sefer/` in the repository's own exclude file, once. */
export const excludeSeferFolder = (
  fileSystem: FileSystem.FileSystem,
  root: string,
): Effect.Effect<void, PlatformError.PlatformError> =>
  Effect.gen(function* () {
    const info = joinPath(root, ".git/info");
    const exclude = joinPath(info, "exclude");
    yield* fileSystem.makeDirectory(info, { recursive: true });
    const current = (yield* fileSystem.exists(exclude))
      ? yield* fileSystem.readFileString(exclude)
      : "";
    if (current.split("\n").includes(EXCLUDE)) return;
    const separator = current === "" || current.endsWith("\n") ? "" : "\n";
    yield* fileSystem.writeFileString(exclude, `${current}${separator}${EXCLUDE}\n`);
  });

export interface IntakeOptions {
  /** The project folder the files were written into. */
  readonly root: string;
  /** Repository-relative paths the import wrote: the arrival commit's receipts. */
  readonly written: readonly string[];
  /** What it arrived from, for the arrival commit's message ("Imported from …"). */
  readonly from: string;
  readonly author: Author;
}

const isPrivate = (path: string): boolean =>
  path === ".git" || path.startsWith(".git/") || path === ".sefer" || path.startsWith(".sefer/");

/**
 * Adopts or creates the repository, excludes `.sefer/`, and records the
 * arrival — all in the repository's exclusive lane, since the allowlist
 * writes inside `.git` directly.
 */
export const intakeRepository = (
  options: IntakeOptions,
): Effect.Effect<
  IntakeResult,
  GitError | PlatformError.PlatformError,
  Git | Repositories | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const repositories = yield* Repositories;
    return yield* Effect.catchTag(
      repositories.exclusive(options.root, "init", program(options)),
      "RepositoryError",
      (error) => Effect.fail(new GitError({ reason: "Refused", description: error.description })),
    );
  });

const program = (options: IntakeOptions) =>
  Effect.gen(function* () {
    const git = yield* Git;
    const fileSystem = yield* FileSystem.FileSystem;
    const observability = Option.getOrUndefined(yield* Effect.serviceOption(Observability));
    const gitDir = joinPath(options.root, ".git");

    let adopted = false;
    let fallback: AdoptFallback | undefined;
    if (yield* fileSystem.exists(gitDir)) {
      const refused = yield* adopt(fileSystem, gitDir);
      if (Option.isSome(refused)) fallback = refused.value;
      else {
        // Adoptable on paper; now it has to open and read. Status reads HEAD's
        // commit and tree, which is where an unreadable history shows itself.
        const readable = yield* Effect.result(
          Effect.flatMap(git.open(options.root), (repo) => git.status(repo)),
        );
        if (readable._tag === "Success") adopted = true;
        else fallback = "unreadable";
      }
      if (!adopted) yield* fileSystem.remove(gitDir, { recursive: true, force: true });
      observability?.note(
        "repository.adopt",
        adopted ? "passed" : "declined",
        fallback,
        fallback === undefined ? {} : { "import.fallback": fallback },
      );
    }
    const repo = adopted ? yield* git.open(options.root) : yield* git.init(options.root);
    if (!adopted) observability?.note("repository.init", "passed");
    yield* excludeSeferFolder(fileSystem, options.root);

    // The arrival: what the import wrote, of which git sees something new.
    const changed = new Set((yield* git.status(repo)).changed.map((entry) => entry.path));
    const receipts = options.written
      .filter((path) => !isPrivate(path) && changed.has(path))
      .map((path) => ({
        path: joinPath(options.root, path),
        stamp: { revision: 0, length: 0 },
      }));
    const arrival =
      receipts.length === 0
        ? undefined
        : yield* git.commit(repo, receipts, `Imported from ${options.from}`, options.author);
    observability?.note(
      "repository.arrival",
      arrival === undefined ? "declined" : "passed",
      undefined,
      {
        "import.adopted": adopted,
        "import.arrival": arrival !== undefined,
        "import.receipts": receipts.length,
      },
    );
    return { repo, adopted, fallback, arrival };
  });
