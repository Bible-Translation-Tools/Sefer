import { Effect, Option } from "effect";

import { Git, type Commit, type Repo } from "#core/git/git";
import { Settings } from "#core/host/settings";
import type { Project } from "#core/project/project";
import { Gitea, type ForkParent, type RemoteRepo } from "#core/remote/gitea";
import { Remote } from "#core/remote/remote";
import { BROUGHT_IN, Suggestions, type Suggestion } from "#core/remote/suggestions";
import { notIn, trackingRef } from "#core/sync";

import { resolveEndpoints } from "./endpoints";
import { t } from "./i18n";
import type { Services } from "./services";
import { chosenMode, setChosenMode, type CollabMode } from "./syncSettings";

const COPY = "copy";

export const copyRef = (branch: string): string => trackingRef(branch, COPY);

export const suggestionRef = (number: number): string => `refs/sefer/pull/${number}`;

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
  readonly username: string | undefined;
}

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
      username: Option.getOrUndefined(Option.map(session, (held) => held.username)),
    } satisfies Where;
  });

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

export const sendingTo = async (services: Services, project: Project): Promise<string> => {
  if ((await modeOf(services, project)) !== "copy") return "origin";
  const attached = await services.run(Effect.orElseSucceed(copyAttached(project), () => false));
  return attached ? COPY : "origin";
};

export const canWriteShared = (
  services: Services,
  project: Project,
): Promise<boolean | undefined> =>
  services.run(
    Effect.orElseSucceed(
      Effect.gen(function* () {
        const at = yield* where(project);
        if (at === undefined || at.username === undefined) return undefined;
        return yield* (yield* Suggestions).canWrite(at.host, at.owner, at.name);
      }),
      () => undefined,
    ),
  );

export type CopyOutcome =
  | {
      readonly kind: "copy";
      readonly copy: string;
      readonly renamed?: true;
    }
  | { readonly kind: "rerooted"; readonly shared: string }
  | { readonly kind: "standalone" };

const copyNames = (shared: RemoteRepo): readonly string[] => {
  const owned = `${shared.name}-${shared.owner.toLowerCase()}`;
  return [shared.name, owned, `${owned}-2`, `${owned}-3`];
};

const existingFork = (host: string, username: string, shared: RemoteRepo) =>
  Effect.gen(function* () {
    const gitea = yield* Gitea;
    const listed = yield* Effect.result(gitea.listForks(host, shared.owner, shared.name));
    if (listed._tag === "Success")
      return Option.fromUndefinedOr(
        listed.success.find((fork) => fork.owner.toLowerCase() === username.toLowerCase()),
      );
    for (const name of copyNames(shared)) {
      const found = yield* gitea.getRepo(host, username, name);
      if (
        Option.isSome(found) &&
        found.value.parent?.fullName.toLowerCase() === shared.fullName.toLowerCase()
      )
        return found;
    }
    return Option.none<RemoteRepo>();
  });

const copyName = (host: string, username: string, shared: RemoteRepo) =>
  Effect.gen(function* () {
    const gitea = yield* Gitea;
    const names = copyNames(shared);
    for (const name of names) {
      const held = yield* gitea.getRepo(host, username, name);
      if (Option.isNone(held)) return name === shared.name ? undefined : name;
    }
    return yield* Effect.fail(
      new Error(`you already hold ${names.join(", ")} on ${host}; rename one and try again`),
    );
  });

export const workInOwnCopy = (services: Services, project: Project): Promise<CopyOutcome> =>
  services.run(
    Effect.gen(function* () {
      const at = yield* where(project);
      if (at === undefined) return yield* Effect.fail(new Error("no shared project to copy"));
      if (at.username === undefined)
        return yield* Effect.fail(new Error("sign in to make your copy"));
      const gitea = yield* Gitea;
      const git = yield* Git;
      const remote = yield* Remote;
      const repo = yield* git.open(project.root);
      const found = yield* gitea.getRepo(at.host, at.owner, at.name);
      if (Option.isNone(found))
        return yield* Effect.fail(new Error(`${at.owner}/${at.name} is not on ${at.host}`));
      const shared = found.value;
      const outcome = yield* Effect.gen(function* () {
        if (shared.owner.toLowerCase() === at.username?.toLowerCase()) {
          const parent: ForkParent | undefined = shared.parent;
          if (parent === undefined) return { kind: "standalone" } satisfies CopyOutcome;
          yield* remote.attachAs(repo, COPY, shared.cloneUrl);
          yield* remote.attach(repo, parent.cloneUrl);
          yield* remote.fetch(repo);
          return { kind: "rerooted", shared: parent.fullName } satisfies CopyOutcome;
        }
        const username = at.username ?? "";
        const held = yield* existingFork(at.host, username, shared);
        const renamed = Option.isSome(held)
          ? undefined
          : yield* copyName(at.host, username, shared);
        const copy = Option.isSome(held)
          ? held.value
          : yield* gitea.forkRepo(at.host, at.owner, at.name, renamed);
        yield* remote.attachAs(repo, COPY, copy.cloneUrl);
        return {
          kind: "copy",
          copy: copy.fullName,
          ...(renamed === undefined ? {} : { renamed: true }),
        } satisfies CopyOutcome;
      });
      if (outcome.kind !== "standalone")
        yield* Effect.orElseSucceed(
          setChosenMode(services.settings, project.root, "copy"),
          () => undefined,
        );
      return outcome;
    }),
  );

export const workInShared = (services: Services, project: Project): Promise<void> =>
  services.run(Effect.asVoid(setChosenMode(services.settings, project.root, "shared")));

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

const suggestionTitle = (now = new Date()): string =>
  t("Changes suggested on {date}", {
    date: now.toLocaleDateString(undefined, { dateStyle: "long" }),
  });

export type CopyStanding = "none" | "shared" | "behind" | "own";

const within = (repo: Repo, older: string, newer: string) =>
  Effect.gen(function* () {
    if (older === newer) return true;
    const base = yield* (yield* Git).mergeBase(repo, older, newer);
    return Option.isSome(base) && base.value === older;
  });

const standingOfCopy = (repo: Repo, branch: string) =>
  Effect.gen(function* () {
    const git = yield* Git;
    const tipOf = (ref: string) => Effect.map(git.resolve(repo, ref), Option.getOrUndefined);
    const copy = yield* tipOf(copyRef(branch));
    const head = yield* tipOf("HEAD");
    const shared = yield* tipOf(trackingRef(branch));
    if (copy === undefined || (head !== undefined && (yield* within(repo, copy, head))))
      return "none";
    if (shared !== undefined && (yield* within(repo, copy, shared))) return "shared";
    if (head !== undefined && (yield* within(repo, head, copy))) return "behind";
    return "own";
  });

const readCopy = (repo: Repo, branch: string) =>
  Effect.gen(function* () {
    const remote = yield* Remote;
    yield* Effect.ignore(remote.fetchRef(repo, `refs/heads/${branch}`, copyRef(branch), COPY));
  });

class NeedsReview extends Error {
  readonly reason = "needs-review";
  constructor(readonly copy: boolean) {
    super(
      copy
        ? "your copy has changes this device does not have"
        : "the shared project has changes this device does not have",
    );
  }
}

export const COPY_REVIEW = { against: "shared", copy: 1 } as const;

const SHARED_REVIEW = { against: "shared" } as const;

export const reviewNeeded = (
  cause: unknown,
):
  | { readonly copy: boolean; readonly search: typeof COPY_REVIEW | typeof SHARED_REVIEW }
  | undefined => {
  if (
    typeof cause !== "object" ||
    cause === null ||
    !("reason" in cause) ||
    cause.reason !== "needs-review"
  )
    return undefined;
  const copy = "copy" in cause && cause.copy === true;
  return { copy, search: copy ? COPY_REVIEW : SHARED_REVIEW };
};

export const suggestMyChanges = (services: Services, project: Project): Promise<Suggestion> =>
  services.run(
    Effect.gen(function* () {
      const at = yield* where(project);
      if (at === undefined || at.username === undefined)
        return yield* Effect.fail(new Error("sign in to suggest changes"));
      const git = yield* Git;
      const remote = yield* Remote;
      const repo = yield* git.open(project.root);
      yield* readCopy(repo, at.branch);
      const standing = yield* standingOfCopy(repo, at.branch);
      const head = Option.getOrUndefined(yield* git.resolve(repo, "HEAD"));
      const sent = Option.getOrUndefined(yield* git.resolve(repo, copyRef(at.branch)));
      const headInCopy =
        head !== undefined && sent !== undefined && (yield* within(repo, head, sent));
      if (standing === "own") return yield* Effect.fail(new NeedsReview(true));
      if (standing === "shared" && !headInCopy) return yield* Effect.fail(new NeedsReview(false));
      if (!headInCopy) yield* remote.push(repo, COPY);
      return yield* (yield* Suggestions).suggest(at.host, at.owner, at.name, {
        from: at.username,
        branch: at.branch,
        base: at.branch,
        title: suggestionTitle(),
        body: "Suggested from Sefer.",
      });
    }),
  );

export const openSuggestions = (
  services: Services,
  project: Project,
): Promise<readonly Suggestion[]> =>
  services.run(
    Effect.orElseSucceed(
      Effect.gen(function* () {
        const at = yield* where(project);
        if (at === undefined) return [];
        const open = yield* (yield* Suggestions).open(at.host, at.owner, at.name);
        const username = at.username?.toLowerCase();
        return username === undefined
          ? open
          : open.filter((each) => each.author.toLowerCase() !== username);
      }),
      (): readonly Suggestion[] => [],
    ),
  );

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

export const acceptSuggestion = (
  services: Services,
  project: Project,
  number: number,
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

export type MySuggestion =
  | { readonly kind: "waiting"; readonly suggestion: Suggestion }
  | { readonly kind: "taken"; readonly suggestion: Suggestion; readonly note: string | undefined }
  | {
      readonly kind: "declined";
      readonly suggestion: Suggestion;
      readonly note: string | undefined;
    };

const MINE_SHOWN = 5;

export const mySuggestions = (
  services: Services,
  project: Project,
): Promise<readonly MySuggestion[]> =>
  services.run(
    Effect.orElseSucceed(
      Effect.gen(function* () {
        const at = yield* where(project);
        if (at === undefined || at.username === undefined) return [];
        const username = at.username;
        const service = yield* Suggestions;
        const all = (yield* service.from(at.host, at.owner, at.name, username)).slice(
          0,
          MINE_SHOWN,
        );
        return yield* Effect.forEach(all, (suggestion) =>
          Effect.gen(function* () {
            if (suggestion.state === "open") return { kind: "waiting", suggestion } as const;
            const said = yield* Effect.orElseSucceed(
              service.noteOn(at.host, at.owner, at.name, suggestion.number, username),
              () => undefined,
            );
            const taken = suggestion.state === "merged" || said?.includes(BROUGHT_IN) === true;
            const note = said?.replace(BROUGHT_IN, "").trim() || undefined;
            return taken
              ? ({ kind: "taken", suggestion, note } as const)
              : ({ kind: "declined", suggestion, note } as const);
          }),
        );
      }),
      (): readonly MySuggestion[] => [],
    ),
  );

export const mySuggestion = async (
  services: Services,
  project: Project,
): Promise<MySuggestion | undefined> => (await mySuggestions(services, project))[0];

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

export const fetchCopy = (services: Services, project: Project): Promise<void> =>
  services.run(
    Effect.orElseSucceed(
      Effect.gen(function* () {
        if (!(yield* copyAttached(project))) return;
        const git = yield* Git;
        const repo = yield* git.open(project.root);
        const branch = Option.getOrUndefined(yield* git.branch(repo));
        if (branch === undefined) return;
        yield* readCopy(repo, branch);
      }),
      () => undefined,
    ),
  );

export const copyHasMore = async (services: Services, project: Project): Promise<boolean> => {
  const standing = await copyStanding(services, project);
  return standing === "behind" || standing === "own";
};

export const copyStanding = (services: Services, project: Project): Promise<CopyStanding> =>
  services.run(
    Effect.orElseSucceed(
      Effect.gen(function* () {
        const git = yield* Git;
        const repo = yield* git.open(project.root);
        const branch = Option.getOrUndefined(yield* git.branch(repo));
        if (branch === undefined) return "none" satisfies CopyStanding;
        return yield* standingOfCopy(repo, branch);
      }),
      (): CopyStanding => "none",
    ),
  );

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
