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
 * or made before) is looked for on the receiver's configured host.
 *
 * Owner and repository go into the path as they are: Gitea allows only
 * letters, digits, `-`, `_` and `.` in either (2026-10-12, `IsValidUsername`
 * and `validRepoNamePattern`), all of which a URL path carries unescaped, and
 * it matches both without regard to case.
 */

/** A shared project, as a link names it. Lower case: Gitea ignores case. */
export interface Source {
  readonly host: string;
  readonly owner: string;
  readonly repo: string;
}

/**
 * The source a remote URL points at, or undefined when it is not an
 * `https://host/owner/repo` address. Credentials, a trailing slash and `.git`
 * are ignored, so a clone URL and the browser address of the same project
 * agree.
 */
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
  return {
    host: parsed.host.toLowerCase(),
    owner: owner.toLowerCase(),
    repo: repo.toLowerCase(),
  };
};

/** The same project, whatever the case or form of the two addresses. */
export const sameSource = (left: Source, right: Source): boolean =>
  left.host === right.host && left.owner === right.owner && left.repo === right.repo;

/** The clone address of a source. */
export const sourceUrl = (source: Source): string =>
  `https://${source.host}/${source.owner}/${source.repo}`;

/** The host part of a configured content host (`https://wacs.org/` → `wacs.org`). */
export const hostOfUrl = (url: string): string | undefined => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
};

/**
 * The share link's path and query for a place in a project.
 *
 * `rest` starts with `/` or is empty. `search` is the place's own query
 * (Find's `q`, Review's `against`); `at` and `host` are added to it, and a
 * place that already used either name loses it, which no screen does today.
 */
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
  query.set("host", source.host);
  const tail = query.size === 0 ? "" : `?${query.toString()}`;
  return `/r/${source.owner}/${source.repo}${rest}${tail}`;
};

/**
 * How the receiver's copy stands against the version a link was made at,
 * from HEAD and the merge base of HEAD and `at` (undefined when git could not
 * find one: the copy lacks that commit, or shares no history with it).
 *
 * - `same`: HEAD is that commit.
 * - `ahead`: the copy holds that commit and has more on top of it.
 * - `behind`: the copy has received that commit but HEAD has not reached it.
 * - `other`: the copy does not hold it, or went its own way from it. Either
 *   the receiver has not checked for changes, or the sender's version was
 *   never sent.
 * - `unknown`: no merge base, and the copy holds only its newest history (a
 *   newest-only clone), so an older `at` is missing for that reason alone and
 *   nothing can be said about which is newer.
 */
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
