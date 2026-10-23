import { Effect, FileSystem, Option, type PlatformError } from "effect";

import { joinPath } from "../fileSystem/path";
import { Observability } from "../observability";
import { Git, GitError, type Author, type CommitId, type Repo } from "./git";
import { Repositories } from "./repository";

export type AdoptFallback = "gitfile" | "in-progress" | "unreadable";

export interface IntakeResult {
  readonly repo: Repo;
  readonly adopted: boolean;
  readonly fallback: AdoptFallback | undefined;
  readonly arrival: CommitId | undefined;
}

const KEEP = new Set(["objects", "refs", "HEAD", "shallow", "packed-refs", "config", "index"]);

const KEEP_REFS = new Set(["heads", "tags"]);

const IN_PROGRESS = [
  "MERGE_HEAD",
  "rebase-merge",
  "rebase-apply",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
];

const CONFIG =
  "[core]\n\trepositoryformatversion = 0\n\tfilemode = false\n\tbare = false\n\tlogallrefupdates = true\n\tsymlinks = false\n\tignorecase = true\n";

const EXCLUDE = ".sefer/";

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
  readonly root: string;
  readonly written: readonly string[];
  readonly from: string;
  readonly author: Author;
  readonly message?: string;
}

const isPrivate = (path: string): boolean =>
  path === ".git" || path.startsWith(".git/") || path === ".sefer" || path.startsWith(".sefer/");

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
        : yield* git.commit(
            repo,
            receipts,
            options.message ?? `Imported from ${options.from}`,
            options.author,
          );
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
