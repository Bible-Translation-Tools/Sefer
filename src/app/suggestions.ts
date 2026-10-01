/**
 * Suggested changes: sending to your own copy of a shared project you cannot
 * write to, suggesting what is there, and — for whoever can write to it —
 * bringing suggestions in or declining them.
 *
 * One topology among several, kept in one place so it can go: a team whose
 * members all write to the shared project never needs any of this. It joins
 * the rest of Sefer at four points, each one line:
 *
 * - composition registers `Suggestions` (`services.ts`);
 * - a send asks `sendingTo` where to go (`syncActions.ts`);
 * - `/cloud` shows `SuggestionsCard`;
 * - Review reads a suggestion like the shared project, from the ref
 *   `suggestionRef` names (`ReviewPanel.tsx`).
 *
 * Take those out and this file, `SuggestionsCard.tsx` and
 * `core/remote/suggestions.ts` are dead code the gate finds; everything else
 * sends to `origin` as it did.
 */
import { Effect, Option } from "effect";

import { Git } from "#core/git/git";
import { Settings } from "#core/host/settings";
import type { Project } from "#core/project/project";
import { Gitea } from "#core/remote/gitea";
import { Remote } from "#core/remote/remote";
import { Suggestions, type Suggestion } from "#core/remote/suggestions";

import { resolveEndpoints } from "./endpoints";
import type { Services } from "./services";

/** The remote a translator's own copy is attached as. */
const COPY = "copy";

/** The local ref a suggestion's head is fetched to, for Review to read. */
export const suggestionRef = (number: number): string => `refs/sefer/pull/${number}`;

/** `owner/name` of a repository URL on the content host. */
const ownerAndName = (
  url: string,
): { readonly owner: string; readonly name: string } | undefined => {
  const parts = url
    .replace(/\.git$/u, "")
    .replace(/\/+$/u, "")
    .split("/");
  const name = parts.at(-1);
  const owner = parts.at(-2);
  return owner === undefined || name === undefined || owner === "" || name === ""
    ? undefined
    : { owner, name };
};

interface Where {
  readonly host: string;
  readonly owner: string;
  readonly name: string;
  readonly branch: string;
  readonly me: string | undefined;
}

/** The shared project this one receives from, and who is signed in. */
const where = (project: Project) =>
  Effect.gen(function* () {
    const git = yield* Git;
    const remote = yield* Remote;
    const gitea = yield* Gitea;
    const settings = yield* Settings;
    const host = resolveEndpoints(settings).contentHost;
    const repo = yield* git.open(project.root);
    const origin = Option.getOrUndefined(yield* remote.origin(repo));
    const branch = Option.getOrUndefined(yield* git.branch(repo));
    const found = origin === undefined ? undefined : ownerAndName(origin);
    if (host === null || found === undefined || branch === undefined) return undefined;
    const session = yield* gitea.session(host);
    return {
      host,
      ...found,
      branch,
      me: Option.getOrUndefined(Option.map(session, (held) => held.username)),
    } satisfies Where;
  });

/** Where a send goes: this translator's own copy when there is one, else the shared project. */
export const sendingTo = (services: Services, project: Project): Promise<string> =>
  services.run(
    Effect.orElseSucceed(
      Effect.gen(function* () {
        const git = yield* Git;
        const remote = yield* Remote;
        const copy = yield* remote.urlOf(yield* git.open(project.root), COPY);
        return Option.isSome(copy) ? COPY : "origin";
      }),
      () => "origin",
    ),
  );

/**
 * Can the signed-in account write to the shared project this one receives
 * from? `undefined` when there is none, or it could not be asked — which is
 * not the same as no.
 */
export const canWriteShared = (
  services: Services,
  project: Project,
): Promise<boolean | undefined> =>
  services.run(
    Effect.orElseSucceed(
      Effect.gen(function* () {
        const at = yield* where(project);
        if (at === undefined || at.me === undefined) return undefined;
        return yield* (yield* Suggestions).canWrite(at.host, at.owner, at.name);
      }),
      () => undefined,
    ),
  );

/** Does this project send to its own copy? */
export const hasOwnCopy = async (services: Services, project: Project): Promise<boolean> =>
  (await sendingTo(services, project)) === COPY;

/**
 * Makes the signed-in account's own copy of the shared project (a Gitea
 * fork), attaches it as where this project sends, and sends there.
 */
export const makeOwnCopy = (services: Services, project: Project): Promise<void> =>
  services.run(
    Effect.gen(function* () {
      const at = yield* where(project);
      if (at === undefined) return yield* Effect.fail(new Error("no shared project to copy"));
      const copy = yield* (yield* Gitea).forkRepo(at.host, at.owner, at.name);
      const git = yield* Git;
      const remote = yield* Remote;
      const repo = yield* git.open(project.root);
      yield* remote.attachAs(repo, COPY, copy.cloneUrl);
      yield* remote.push(repo, COPY);
    }),
  );

/**
 * Suggests what this project's copy holds to the shared project: one open
 * suggestion, which later sends to the copy keep up to date by themselves.
 */
export const suggestMyChanges = (
  services: Services,
  project: Project,
  title: string,
): Promise<Suggestion> =>
  services.run(
    Effect.gen(function* () {
      const at = yield* where(project);
      if (at === undefined || at.me === undefined)
        return yield* Effect.fail(new Error("sign in to suggest changes"));
      return yield* (yield* Suggestions).suggest(at.host, at.owner, at.name, {
        from: at.me,
        branch: at.branch,
        base: at.branch,
        title,
        body: "Suggested from Sefer.",
      });
    }),
  );

/** The open suggestions to the shared project, for whoever can write to it. */
export const openSuggestions = (
  services: Services,
  project: Project,
): Promise<readonly Suggestion[]> =>
  services.run(
    Effect.orElseSucceed(
      Effect.gen(function* () {
        const at = yield* where(project);
        if (at === undefined) return [];
        return yield* (yield* Suggestions).open(at.host, at.owner, at.name);
      }),
      (): readonly Suggestion[] => [],
    ),
  );

/**
 * Fetches a suggestion's head from the shared project itself (Gitea keeps
 * `refs/pull/<n>/head` on the base repository) to the ref Review reads it
 * from. Nothing in the work tree moves.
 */
export const fetchSuggestion = (
  services: Services,
  project: Project,
  suggestion: Suggestion,
): Promise<string> =>
  services.run(
    Effect.gen(function* () {
      const git = yield* Git;
      const remote = yield* Remote;
      const repo = yield* git.open(project.root);
      return yield* remote.fetchRef(
        repo,
        `refs/pull/${suggestion.number}/head`,
        suggestionRef(suggestion.number),
      );
    }),
  );

/** Closes a suggestion without bringing it in, with the note its author will read. */
export const declineSuggestion = (
  services: Services,
  project: Project,
  suggestion: Suggestion,
  note: string,
): Promise<void> =>
  services.run(
    Effect.gen(function* () {
      const at = yield* where(project);
      if (at === undefined) return;
      yield* (yield* Suggestions).decline(at.host, at.owner, at.name, suggestion.number, note);
    }),
  );
