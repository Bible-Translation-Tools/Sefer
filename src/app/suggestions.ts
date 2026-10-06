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

import { Git, type Commit } from "#core/git/git";
import { Settings } from "#core/host/settings";
import type { Project } from "#core/project/project";
import { Gitea, type ForkParent, type RemoteRepo } from "#core/remote/gitea";
import { Remote } from "#core/remote/remote";
import { Suggestions, type Suggestion } from "#core/remote/suggestions";
import { notIn, trackingRef } from "#core/sync";

import { resolveEndpoints } from "./endpoints";
import { t } from "./i18n";
import type { Services } from "./services";
import { chosenMode, setChosenMode, type CollabMode } from "./syncSettings";

/** The remote a translator's own copy is attached as. */
const COPY = "copy";

/**
 * The local ref that holds the person's copy: its remote-tracking ref, which
 * a send to the copy moves by itself and a read of the copy (`fetchCopy`)
 * writes. One ref for both, so what was sent and what was read cannot
 * disagree. It is outside `refs/remotes/origin/`, the only place the Web's
 * pruning fetch clears.
 */
export const copyRef = (branch: string): string => trackingRef(branch, COPY);

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
/**
 * Is a copy attached to this project that belongs to whoever is signed in?
 *
 * The copy remote is kept on this device, not with an account: one account's
 * copy, left attached when another signs in, is not the second person's, and
 * sending there would put their work in someone else's copy (or succeed, for
 * an admin). So a copy counts only when its owner is the signed-in account;
 * otherwise the person makes or finds their own, which re-points the remote.
 */
const copyAttached = (project: Project) =>
  Effect.gen(function* () {
    const git = yield* Git;
    const remote = yield* Remote;
    const url = Option.getOrUndefined(yield* remote.urlOf(yield* git.open(project.root), COPY));
    const owner = url === undefined ? undefined : ownerAndName(url)?.owner;
    if (owner === undefined) return false;
    const host = resolveEndpoints(yield* Settings).contentHost;
    const session = host === null ? Option.none() : yield* (yield* Gitea).session(host);
    return Option.isSome(session) && session.value.username.toLowerCase() === owner.toLowerCase();
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
 * project. Sets the mode; sending is the next send's.
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
        // Attached, not sent: a fresh copy already holds the shared project's
        // history, and this device's own work goes at the next send — after
        // receiving, when this device is behind (a send now would be refused).
        yield* remote.attachAs(repo, COPY, copy.cloneUrl);
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
/**
 * A new suggestion's title: the day it was offered, in the reader's own date
 * format. Not a summary — nobody is asked to write one yet — but enough that
 * a list of them is not a column of identical "Suggested changes".
 */
const suggestionTitle = (now = new Date()): string =>
  t("Changes suggested on {date}", {
    date: now.toLocaleDateString(undefined, { dateStyle: "long" }),
  });

export const suggestMyChanges = (services: Services, project: Project): Promise<Suggestion> =>
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
        title: suggestionTitle(),
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
  suggestion: Pick<Suggestion, "number">,
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
  /** The reviewer's message for the version: also the note its author reads. */
  note: string,
): Promise<void> =>
  services.run(
    Effect.gen(function* () {
      const at = yield* where(project);
      if (at === undefined) return;
      const git = yield* Git;
      const head = yield* git.resolve(yield* git.open(project.root), "HEAD");
      if (Option.isNone(head)) return;
      yield* (yield* Suggestions).accept(at.host, at.owner, at.name, number, head.value, note);
    }),
  );

/** How one of the person's suggestions stands, as its author reads it. */
export type MySuggestion =
  | { readonly kind: "waiting"; readonly suggestion: Suggestion }
  | { readonly kind: "taken"; readonly suggestion: Suggestion }
  | {
      readonly kind: "declined";
      readonly suggestion: Suggestion;
      readonly note: string | undefined;
    };

/** How many of the person's suggestions are read, newest first: the recent story, not an archive. */
const MINE_SHOWN = 5;

/**
 * The person's suggestions to the shared project, newest first.
 *
 * "Taken" is asked of git, not of Gitea's flag: a suggestion Review brought
 * in is a decision commit with the suggestion's head as a parent, which a
 * Gitea that does not allow "manually merged" never calls merged. Its head
 * being in the shared project's history is the answer either way. The
 * editor's note is read only for a declined one.
 */
export const mySuggestions = (
  services: Services,
  project: Project,
): Promise<readonly MySuggestion[]> =>
  services.run(
    Effect.orElseSucceed(
      Effect.gen(function* () {
        const at = yield* where(project);
        if (at === undefined || at.me === undefined) return [];
        const me = at.me;
        const service = yield* Suggestions;
        const all = (yield* service.from(at.host, at.owner, at.name, me)).slice(0, MINE_SHOWN);
        const git = yield* Git;
        const repo = yield* git.open(project.root);
        const shared = trackingRef(at.branch);
        return yield* Effect.forEach(all, (suggestion) =>
          Effect.gen(function* () {
            if (suggestion.state === "open") return { kind: "waiting", suggestion } as const;
            if (suggestion.state === "merged") return { kind: "taken", suggestion } as const;
            const head = suggestion.head;
            const base =
              head === undefined
                ? Option.none()
                : yield* Effect.orElseSucceed(git.mergeBase(repo, head, shared), () =>
                    Option.none(),
                  );
            if (Option.isSome(base) && base.value === head)
              return { kind: "taken", suggestion } as const;
            const note = yield* Effect.orElseSucceed(
              service.noteOn(at.host, at.owner, at.name, suggestion.number, me),
              () => undefined,
            );
            return { kind: "declined", suggestion, note } as const;
          }),
        );
      }),
      (): readonly MySuggestion[] => [],
    ),
  );

/** The person's newest suggestion, for the popover's one line. */
export const mySuggestion = async (
  services: Services,
  project: Project,
): Promise<MySuggestion | undefined> => (await mySuggestions(services, project))[0];

/** Withdraws the person's own open suggestion: closed, nothing in their copy changes. */
export const withdrawSuggestion = (
  services: Services,
  project: Project,
  suggestion: Suggestion,
): Promise<void> =>
  services.run(
    Effect.gen(function* () {
      const at = yield* where(project);
      if (at === undefined) return;
      yield* (yield* Suggestions).decline(at.host, at.owner, at.name, suggestion.number, "");
    }),
  );

/**
 * Reads the person's copy, for the check in the copy mode: what another of
 * their devices sent there arrives in `copyRef`, not in the work tree.
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
        yield* remote.fetchRef(repo, `refs/heads/${branch}`, copyRef(branch), COPY);
      }),
      () => undefined,
    ),
  );

/**
 * Has the person's copy work from another of their devices — work neither this
 * device nor the shared project has? A fresh copy holds the shared project's
 * versions, and those are the shared project's to bring, not the copy's.
 */
export const copyHasMore = (services: Services, project: Project): Promise<boolean> =>
  services.run(
    Effect.orElseSucceed(
      Effect.gen(function* () {
        const git = yield* Git;
        const repo = yield* git.open(project.root);
        const branch = Option.getOrUndefined(yield* git.branch(repo));
        if (branch === undefined) return false;
        const copy = yield* git.resolve(repo, copyRef(branch));
        if (Option.isNone(copy)) return false;
        /** Is the copy's tip already in `ref`'s history? */
        const within = (ref: string) =>
          Effect.gen(function* () {
            const tip = yield* git.resolve(repo, ref);
            if (Option.isNone(tip)) return false;
            if (tip.value === copy.value) return true;
            const base = yield* git.mergeBase(repo, copy.value, tip.value);
            return Option.isSome(base) && base.value === copy.value;
          });
        if (yield* within("HEAD")) return false;
        return !(yield* within(trackingRef(branch)));
      }),
      () => false,
    ),
  );

/** Has this device work the shared project does not — something an offer would carry? */
export const aheadOfShared = (services: Services, project: Project): Promise<boolean> =>
  services.run(
    Effect.orElseSucceed(
      Effect.gen(function* () {
        const git = yield* Git;
        const repo = yield* git.open(project.root);
        const branch = Option.getOrUndefined(yield* git.branch(repo));
        const head = yield* git.resolve(repo, "HEAD");
        if (branch === undefined || Option.isNone(head)) return false;
        const shared = yield* git.resolve(repo, trackingRef(branch));
        if (Option.isNone(shared)) return true;
        if (shared.value === head.value) return false;
        const base = yield* git.mergeBase(repo, head.value, shared.value);
        return !(Option.isSome(base) && base.value === head.value);
      }),
      () => false,
    ),
  );

/**
 * Where a send goes, as a person reads it — `owner/name` — or `undefined`
 * when this project sends nowhere.
 */
export const sendingToName = async (
  services: Services,
  project: Project,
): Promise<string | undefined> => {
  const name = await sendingTo(services, project);
  return services.run(
    Effect.orElseSucceed(
      Effect.gen(function* () {
        const git = yield* Git;
        const remote = yield* Remote;
        const url = Option.getOrUndefined(yield* remote.urlOf(yield* git.open(project.root), name));
        const found = url === undefined ? undefined : ownerAndName(url);
        return found === undefined ? undefined : `${found.owner}/${found.name}`;
      }),
      () => undefined,
    ),
  );
};

/**
 * One suggestion as a reviewer reads it: who offered it, its title, and the
 * messages of the versions it brings that this project does not have yet —
 * read from its head, already fetched to `suggestionRef` for the review.
 */
export interface SuggestionDetails {
  readonly suggestion: Suggestion;
  readonly versions: readonly Commit[];
}

export const suggestionDetails = (
  services: Services,
  project: Project,
  number: number,
): Promise<SuggestionDetails | undefined> =>
  services.run(
    Effect.orElseSucceed(
      Effect.gen(function* () {
        const at = yield* where(project);
        if (at === undefined) return undefined;
        const suggestion = yield* (yield* Suggestions).one(at.host, at.owner, at.name, number);
        if (suggestion === undefined) return undefined;
        const git = yield* Git;
        const repo = yield* git.open(project.root);
        const theirs = yield* Effect.orElseSucceed(
          git.logFrom(repo, suggestionRef(number)),
          (): readonly Commit[] => [],
        );
        const here = yield* Effect.orElseSucceed(git.log(repo), (): readonly Commit[] => []);
        return { suggestion, versions: notIn(theirs, here) };
      }),
      () => undefined,
    ),
  );
