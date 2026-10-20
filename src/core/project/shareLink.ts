/**
 * Links to a place in a project, by where the project came from.
 *
 * A slug (`slug.ts`) is this device's name for a project: the folder it was
 * copied into, folded for a URL. Two people with the same shared project have
 * different folders, so a slug cannot be sent to anyone. A share link names
 * the SOURCE instead, the shared project's owner and repository, and each
 * device answers "do I have something that came from there?" for itself:
 *
 *     /r/<owner>/<repo>/<rest of the path>?at=<commit>&host=<host>
 *
 * `rest` is everything after `/project/<slug>` (`/book/JHN`, `/terms`), and
 * the arriving device puts its own slug in front of it. `at` is the version
 * the sender was looking at, so the receiver can be told when theirs differs:
 * a demo or a review is only about the same text when it is the same commit.
 * `host` is always written. The sender's configured cloud says nothing about
 * the receiver's: the dev channel's is WACS dev and production's is WACS, so
 * a link copied on one and opened on the other found nothing when it was left
 * out for "the usual host" (2026-10-12). A link without it (typed by hand,
 * or made before) is looked for on the receiver's configured host. It is the
 * bare host (`host=wacs.org`) for the usual `https://<host>`, so those links
 * read as they always did, and the whole base otherwise
 * (`host=http://localhost:3000`, `host=https://h/git`): a Gitea on plain http,
 * or served under a path, is a different place from `https://<host>`.
 *
 * Owner and repository go into the path as they are: Gitea allows only
 * letters, digits, `-`, `_` and `.` in either (2026-10-12, `IsValidUsername`
 * and `validRepoNamePattern`), all of which a URL path carries unescaped, and
 * it matches both without regard to case.
 */

export interface Source {
  readonly host: string;
  /**
   * Where the server's repositories start: scheme, host and any path prefix
   * before owner/repo (`https://wacs.org`, `http://localhost:3000`,
   * `https://h/git`), no trailing slash. What a clone URL is built from and
   * what two sources are compared by.
   */
  readonly base: string;
  readonly owner: string;
  readonly repo: string;
}

/**
 * The host and base a link's `host=` (or a configured content host) names: a
 * bare host is `https://<host>`; a URL is taken whole, scheme and path prefix
 * kept. Undefined when it is neither.
 */
export const placeOf = (named: string): Pick<Source, "host" | "base"> | undefined => {
  let parsed: URL;
  try {
    parsed = new URL(named.includes("://") ? named : `https://${named}`);
  } catch {
    return undefined;
  }
  if (parsed.host === "") return undefined;
  const host = parsed.host.toLowerCase();
  const prefix = parsed.pathname.replace(/\/+$/u, "");
  return { host, base: `${parsed.protocol}//${host}${prefix}`.toLowerCase() };
};

export const sourceOf = (url: string): Source | undefined => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const parts = parsed.pathname
    .replace(/\/+$/u, "")
    .replace(/\.git$/iu, "")
    .split("/")
    .filter((part) => part !== "");
  const [owner, repo] = parts.slice(-2);
  if (parts.length < 2 || owner === undefined || repo === undefined) return undefined;
  const host = parsed.host.toLowerCase();
  const prefix = parts
    .slice(0, -2)
    .map((part) => `/${part}`)
    .join("");
  return {
    host,
    base: `${parsed.protocol}//${host}${prefix}`.toLowerCase(),
    owner: owner.toLowerCase(),
    repo: repo.toLowerCase(),
  };
};

export const sameSource = (left: Source, right: Source): boolean =>
  left.base === right.base && left.owner === right.owner && left.repo === right.repo;

export const sourceUrl = (source: Source): string =>
  `${source.base}/${source.owner}/${source.repo}`;

/** What a link's `host=` says: the bare host for the usual `https://<host>`, else the base. */
const hostParam = (source: Source): string =>
  source.base === `https://${source.host}` ? source.host : source.base;

/** The host part of a configured content host (`https://wacs.org/` → `wacs.org`). */
export const hostOfUrl = (url: string): string | undefined => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
};

export const shareLinkPath = (
  source: Source,
  rest: string,
  search: URLSearchParams,
  at: string | undefined,
): string => {
  const query = new URLSearchParams(search);
  query.delete("at");
  query.delete("host");
  if (at !== undefined) query.set("at", at);
  query.set("host", hostParam(source));
  const tail = query.size === 0 ? "" : `?${query.toString()}`;
  return `/r/${source.owner}/${source.repo}${rest}${tail}`;
};

export type VersionStanding = "same" | "ahead" | "behind" | "other" | "unknown";

export const versionStanding = (
  at: string,
  head: string | undefined,
  base: string | undefined,
  shallow: boolean,
): VersionStanding =>
  head === at
    ? "same"
    : base === at
      ? "ahead"
      : base !== undefined && base === head
        ? "behind"
        : base === undefined && shallow
          ? "unknown"
          : "other";
