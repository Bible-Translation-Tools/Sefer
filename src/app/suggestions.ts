/**
 * The two ways to work with other people, and suggested changes.
 *
 * A project is worked on in ONE of two modes, chosen per project on this
 * device (`CollabMode`, `syncSettings.ts`): in the shared project itself, or
 * in the person's own copy of it (a Gitea fork, attached as the remote
 * `copy`), offering their changes as a suggestion when ready. Never a remote
 * per press. Someone who can write to the shared project starts in the first
 * and may choose the second; someone who cannot is sent to the second by the
 * first refused send. Whoever can write to the shared project brings
 * suggestions in, or declines them.
 *
 * One topology among several, kept in one place so it can go: a team whose
 * members all write to the shared project never needs any of this. It joins
 * the rest of Sefer at four points, each one line:
 *
 * - composition registers `Suggestions` (`services.ts`);
 * - a send asks `sendingTo` where to go (`syncActions.ts`);
 * - `collaboration.ts` holds what the surfaces show about it;
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
import { Gitea, type ForkParent, type RemoteRepo } from "#core/remote/gitea";
import { Remote } from "#core/remote/remote";
import { Suggestions, type Suggestion } from "#core/remote/suggestions";
import { trackingRef } from "#core/sync";

import { resolveEndpoints } from "./endpoints";
import type { Services } from "./services";
import { chosenMode, setChosenMode, type CollabMode } from "./syncSettings";

/** The remote a translator's own copy is attached as. */
const COPY = "copy";

/**
 * The local ref the person's copy is read into, for Review to read: one ref,
 * outside `refs/remotes/origin/`, which the Web's pruning fetch clears of
 * every ref it did not write.
 */
export const COPY_REF = "refs/sefer/copy";

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

/** Is a copy attached to this project? */
const copyAttached = (project: Project) =>
  Effect.gen(function* () {
    const git = yield* Git;
    const remote = yield* Remote;
    return Option.isSome(yield* remote.urlOf(yield* git.open(project.root), COPY));
  });

/**
 * The project's mode: what was chosen on this device, else what the
 * repository says — a project with a copy attached was working in it before
 * the mode had a name.
 */
export const modeOf = (services: Services, project: Project): Promise<CollabMode> => {
  const chosen = chosenMode(services.settings, project.root);
  if (chosen !== undefined) return Promise.resolve(chosen);
  return services.run(
    Effect.orElseSucceed(
      Effect.map(copyAttached(project), (attached): CollabMode => (attached ? "copy" : "shared")),
      (): CollabMode => "shared",
    ),
  );
};

/**
 * Where a send goes: the person's copy in the copy mode, the shared project
 * otherwise. A copy mode with no copy attached yet sends nowhere new — it
 * falls back to the shared project, whose refusal says what to do.
 */
export const sendingTo = async (services: Services, project: Project): Promise<string> => {
  if ((await modeOf(services, project)) !== "copy") return "origin";
  const attached = await services.run(Effect.orElseSucceed(copyAttached(project), () => false));
  return attached ? COPY : "origin";
};

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

/** What choosing the copy mode came to. */
export type CopyOutcome =
  /** The copy is attached (made now, or found already made) and has this device's work. */
  | { readonly kind: "copy"; readonly copy: string }
  /**
   * The project was cloned from the person's own copy: it is now the copy,
   * and the project it was copied from is the shared one.
   */
  | { readonly kind: "rerooted"; readonly shared: string }
  /**
   * The shared project belongs to this account and copies nothing: there is
   * nothing to suggest to until the person names the project that is.
   */
  | { readonly kind: "standalone" };

/** The signed-in account's fork of `shared`, when one exists already. */
const existingFork = (host: string, me: string, shared: RemoteRepo) =>
  Effect.gen(function* () {
    const found = yield* (yield* Gitea).getRepo(host, me, shared.name);
    return Option.filter(
      found,
      (repo) => repo.parent?.fullName.toLowerCase() === shared.fullName.toLowerCase(),
    );
  });

/**
 * Work in the person's own copy from now on.
 *
 * Never forks twice: a copy made on another device is found and attached
 * (Gitea refuses a second fork of the same project). A project cloned from
 * the person's own fork is re-rooted instead — its parent becomes the shared
 * project. Sends this device's work to the copy, and sets the mode.
 */
export const workInOwnCopy = (services: Services, project: Project): Promise<CopyOutcome> =>
  services.run(
    Effect.gen(function* () {
      const at = yield* where(project);
      if (at === undefined) return yield* Effect.fail(new Error("no shared project to copy"));
      if (at.me === undefined) return yield* Effect.fail(new Error("sign in to make your copy"));
      const gitea = yield* Gitea;
      const git = yield* Git;
      const remote = yield* Remote;
      const repo = yield* git.open(project.root);
      const found = yield* gitea.getRepo(at.host, at.owner, at.name);
      if (Option.isNone(found))
        return yield* Effect.fail(new Error(`${at.owner}/${at.name} is not on ${at.host}`));
      const shared = found.value;
      const outcome = yield* Effect.gen(function* () {
        if (shared.owner.toLowerCase() === at.me?.toLowerCase()) {
          const parent: ForkParent | undefined = shared.parent;
          if (parent === undefined) return { kind: "standalone" } satisfies CopyOutcome;
          // Cloned from their own copy: that is the copy, its parent is shared.
          yield* remote.attachAs(repo, COPY, shared.cloneUrl);
          yield* remote.attach(repo, parent.cloneUrl);
          yield* remote.fetch(repo);
          return { kind: "rerooted", shared: parent.fullName } satisfies CopyOutcome;
        }
        const held = yield* existingFork(at.host, at.me ?? "", shared);
        const copy = Option.isSome(held)
          ? held.value
          : yield* gitea.forkRepo(at.host, at.owner, at.name);
        yield* remote.attachAs(repo, COPY, copy.cloneUrl);
        yield* remote.push(repo, COPY);
        return { kind: "copy", copy: copy.fullName } satisfies CopyOutcome;
      });
      if (outcome.kind !== "standalone")
        yield* Effect.orElseSucceed(
          setChosenMode(services.settings, project.root, "copy"),
          () => undefined,
        );
      return outcome;
    }),
  );

/**
 * Work in the shared project again, for someone who can write to it: the
 * next send goes there. The copy stays attached, for coming back to.
 */
export const workInShared = (services: Services, project: Project): Promise<void> =>
  services.run(Effect.asVoid(setChosenMode(services.settings, project.root, "shared")));

/**
 * For a shared project that is the person's own and copies nothing: name the
 * project it should suggest to. That one becomes the shared project and the
 * person's becomes their copy — but only when the two share history; when
 * they do not, everything is put back as it was and the answer says so,
 * because suggesting one unrelated project to another would offer the whole
 * of it.
 */
export const suggestTo = (
  services: Services,
  project: Project,
  target: string,
): Promise<{ readonly related: boolean; readonly shared: string }> =>
  services.run(
    Effect.gen(function* () {
      const host = resolveEndpoints(yield* Settings).contentHost;
      const named = ownerAndName(target.trim());
      if (host === null || named === undefined)
        return yield* Effect.fail(new Error(`"${target}" does not name a project`));
      const found = yield* (yield* Gitea).getRepo(host, named.owner, named.name);
      if (Option.isNone(found))
        return yield* Effect.fail(new Error(`${named.owner}/${named.name} is not on ${host}`));
      const git = yield* Git;
      const remote = yield* Remote;
      const repo = yield* git.open(project.root);
      const mine = Option.getOrUndefined(yield* remote.origin(repo));
      const branch = Option.getOrUndefined(yield* git.branch(repo));
      if (mine === undefined || branch === undefined)
        return yield* Effect.fail(new Error("this project has no shared project yet"));
      yield* remote.attach(repo, found.value.cloneUrl);
      yield* remote.fetch(repo);
      const base = yield* git.mergeBase(repo, "HEAD", trackingRef(branch));
      if (Option.isNone(base)) {
        yield* remote.attach(repo, mine);
        yield* remote.fetch(repo);
        return { related: false, shared: found.value.fullName };
      }
      yield* remote.attachAs(repo, COPY, mine);
      yield* setChosenMode(services.settings, project.root, "copy");
      return { related: true, shared: found.value.fullName };
    }),
  );

/**
 * Suggests what this project's copy holds to the shared project: one open
 * suggestion per person, which later sends to the copy keep up to date by
 * themselves. Sends first, so the suggestion holds this device's newest work.
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
      const git = yield* Git;
      const remote = yield* Remote;
      yield* remote.push(yield* git.open(project.root), COPY);
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

/**
 * After a suggestion was brought in by Review and sent: tell the shared
 * project, so its author sees it taken rather than waiting. Gitea marks it
 * merged by the commit just sent when the repository allows that, and it is
 * closed with a note otherwise.
 */
export const acceptSuggestion = (
  services: Services,
  project: Project,
  number: number,
): Promise<void> =>
  services.run(
    Effect.gen(function* () {
      const at = yield* where(project);
      if (at === undefined) return;
      const git = yield* Git;
      const head = yield* git.resolve(yield* git.open(project.root), "HEAD");
      if (Option.isNone(head)) return;
      yield* (yield* Suggestions).accept(at.host, at.owner, at.name, number, head.value);
    }),
  );

/** How the person's newest suggestion stands, as its author reads it. */
export type MySuggestion =
  | { readonly kind: "waiting"; readonly suggestion: Suggestion }
  | { readonly kind: "taken"; readonly suggestion: Suggestion }
  | {
      readonly kind: "declined";
      readonly suggestion: Suggestion;
      readonly note: string | undefined;
    };

/**
 * The person's newest suggestion to the shared project.
 *
 * "Taken" is asked of git, not of Gitea's flag: a suggestion Review brought
 * in is a decision commit with the suggestion's head as a parent, which a
 * Gitea that does not allow "manually merged" never calls merged. Its head
 * being in the shared project's history is the answer either way.
 */
export const mySuggestion = (
  services: Services,
  project: Project,
): Promise<MySuggestion | undefined> =>
  services.run(
    Effect.orElseSucceed(
      Effect.gen(function* () {
        const at = yield* where(project);
        if (at === undefined || at.me === undefined) return undefined;
        const latest = yield* (yield* Suggestions).latestFrom(at.host, at.owner, at.name, at.me);
        if (latest === undefined) return undefined;
        const { suggestion, note } = latest;
        if (suggestion.state === "open") return { kind: "waiting", suggestion } as const;
        if (suggestion.state === "merged") return { kind: "taken", suggestion } as const;
        const git = yield* Git;
        const repo = yield* git.open(project.root);
        const head = suggestion.head;
        const base =
          head === undefined
            ? Option.none()
            : yield* Effect.orElseSucceed(git.mergeBase(repo, head, trackingRef(at.branch)), () =>
                Option.none(),
              );
        return Option.isSome(base) && base.value === head
          ? ({ kind: "taken", suggestion } as const)
          : ({ kind: "declined", suggestion, note } as const);
      }),
      () => undefined,
    ),
  );

/**
 * Reads the person's copy, for the check in the copy mode: what another of
 * their devices sent there arrives here as `COPY_REF`, not in the work tree.
 * Nothing when no copy is attached or it has no branch yet.
 */
export const fetchCopy = (services: Services, project: Project): Promise<void> =>
  services.run(
    Effect.orElseSucceed(
      Effect.gen(function* () {
        if (!(yield* copyAttached(project))) return;
        const git = yield* Git;
        const remote = yield* Remote;
        const repo = yield* git.open(project.root);
        const branch = Option.getOrUndefined(yield* git.branch(repo));
        if (branch === undefined) return;
        yield* remote.fetchRef(repo, `refs/heads/${branch}`, COPY_REF, COPY);
      }),
      () => undefined,
    ),
  );

/** Has the person's copy work this device does not — from another of their devices? */
export const copyHasMore = (services: Services, project: Project): Promise<boolean> =>
  services.run(
    Effect.orElseSucceed(
      Effect.gen(function* () {
        const git = yield* Git;
        const repo = yield* git.open(project.root);
        const copy = yield* git.resolve(repo, COPY_REF);
        const head = yield* git.resolve(repo, "HEAD");
        if (Option.isNone(copy) || Option.isNone(head)) return false;
        if (copy.value === head.value) return false;
        const base = yield* git.mergeBase(repo, copy.value, head.value);
        return !(Option.isSome(base) && base.value === copy.value);
      }),
      () => false,
    ),
  );
