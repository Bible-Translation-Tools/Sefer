import type { BookId } from "@sefer/text/book";
import { decode, type Source } from "@sefer/text/source";
import { Effect, Option, Result } from "effect";
import { createEffect, createSignal, type Accessor } from "solid-js";

import { Git, repositoryPath, type Repo } from "#core/git/git";
import type { Project } from "#core/project/project";
import { trackingRef } from "#core/sync";

import type { Shell } from "../../ProjectContext";

export interface Recorded {
  readonly head: string | undefined;
  readonly texts: ReadonlyMap<BookId, Source>;
  readonly read: boolean;
}

const NOTHING: Recorded = { head: undefined, texts: new Map(), read: true };

const HELD = 4 * 70;
const held = new Map<string, Source>();
const textAt = (key: string): Source | undefined => {
  const found = held.get(key);
  if (found !== undefined) {
    held.delete(key);
    held.set(key, found);
  }
  return found;
};
const hold = (key: string, source: Source): void => {
  held.set(key, source);
  while (held.size > HELD) {
    const oldest = held.keys().next();
    if (oldest.done === true) break;
    held.delete(oldest.value);
  }
};

export interface RecordedVersion {
  readonly recorded: Accessor<Recorded>;
  readonly refresh: () => void;
}

export type RecordedRef = "head" | "shared" | "base";

const none = () => Option.none<string>();

const tipOf = (ref: RecordedRef, theirs: (() => string | undefined) | undefined, repo: Repo) =>
  Effect.gen(function* () {
    const git = yield* Git;
    if (ref === "head") {
      const tip = yield* Effect.orElseSucceed(git.resolve(repo, "HEAD"), none);
      return Option.getOrUndefined(tip);
    }
    const branch = yield* Effect.orElseSucceed(git.branch(repo), none);
    const tip = Option.isNone(branch)
      ? Option.none<string>()
      : yield* Effect.orElseSucceed(
          git.resolve(repo, theirs?.() ?? trackingRef(branch.value)),
          none,
        );
    let head = Option.getOrUndefined(tip);
    if (ref === "base" && head !== undefined) {
      const theirTip = head;
      const mine = yield* Effect.orElseSucceed(git.resolve(repo, "HEAD"), none);
      head = Option.isNone(mine)
        ? undefined
        : Option.getOrUndefined(
            yield* Effect.orElseSucceed(git.mergeBase(repo, mine.value, theirTip), none),
          );
    }
    return head;
  });

const readTexts = (project: Project, repo: Repo, head: string) =>
  Effect.gen(function* () {
    const git = yield* Git;
    const texts = new Map<BookId, Source>();
    for (const book of project.books) {
      const inside = repositoryPath(project.root, book.path);
      if (Option.isNone(inside)) continue;
      const key = `${project.root}\0${head}\0${inside.value}`;
      const known = textAt(key);
      if (known !== undefined) {
        texts.set(book.id, known);
        continue;
      }
      const bytes = yield* Effect.result(git.show(repo, head, inside.value));
      if (Result.isFailure(bytes)) continue;
      const source = decode(bytes.success);
      if (Result.isFailure(source)) continue;
      hold(key, source.success);
      texts.set(book.id, source.success);
    }
    return texts;
  });

const readRecorded = (
  project: Project,
  ref: RecordedRef,
  theirs: (() => string | undefined) | undefined,
) =>
  Effect.gen(function* () {
    const git = yield* Git;
    const opened = yield* Effect.result(git.open(project.root));
    if (Result.isFailure(opened)) return NOTHING;
    const repo = opened.success;
    const head = yield* tipOf(ref, theirs, repo);
    if (head === undefined) return NOTHING;
    const texts = yield* readTexts(project, repo, head);
    return { head, texts, read: true } satisfies Recorded;
  });

export const createRecordedVersion = (
  shell: Shell,
  ref: RecordedRef = "head",
  theirs?: () => string | undefined,
): RecordedVersion => {
  const [recorded, setRecorded] = createSignal<Recorded>(
    { head: undefined, texts: new Map(), read: false },
    { name: "recordedVersion" },
  );

  const load = (project: Project | undefined): void => {
    if (project === undefined) {
      void Promise.resolve().then(() => setRecorded(NOTHING));
      return;
    }
    void shell.services.run(readRecorded(project, ref, theirs)).then(setRecorded);
  };

  createEffect(
    () => shell.project(),
    (project) => {
      load(project);
    },
  );

  return { recorded, refresh: () => load(shell.project()) };
};
