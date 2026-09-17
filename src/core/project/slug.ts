/**
 * Project slugs — the short, readable name a project has in a URL.
 *
 * A project is identified by its root, which is a filesystem path, and a path
 * makes a terrible URL segment: `/project/%2Fsefer%2Fprojects%2Fen_ulb` is
 * unreadable, survives one round of encoding badly and two not at all. The
 * slug is what the address bar shows instead — `/project/en-ulb` — and the
 * index that maps it back to a root lives in settings beside the recents.
 *
 * Deliberately NOT a hash. The point is that a person can read it, recognise
 * their own project in a list of tabs, and type it.
 */

/**
 * One name, folded to the characters a URL can carry without escaping.
 *
 * Latin letters, digits and single hyphens; everything else is a separator.
 * Accents are folded rather than dropped, so `Español` is `espanol` and not
 * `espa-ol` — NFKD splits a letter from its combining marks and the marks are
 * what we remove.
 *
 * Scripts with no Latin form at all — Amharic, Devanagari, Han — fold to
 * nothing, and that is the case `fallback` exists for. A translator working in
 * their own script should not get an empty URL segment, and transliterating
 * their language name into ASCII would be a worse answer than a neutral one.
 */
export const slugify = (name: string, fallback = "project"): string => {
  const folded = name
    .normalize("NFKD")
    // The combining marks NFKD just separated out.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Long enough to stay recognisable, short enough to read in a tab title.
  const capped = folded.slice(0, 48).replace(/-+$/, "");
  return capped === "" ? fallback : capped;
};

/** The folder name a root ends in — what a slug is made from. */
export const nameOfRoot = (root: string): string => {
  const trimmed = root.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
};

/**
 * A slug for `root` that no OTHER root in `taken` already holds.
 *
 * Two projects can genuinely be called `en_ulb` — one in Downloads and one on a
 * stick — and the second cannot silently steal the first's URL. It gets
 * `en-ulb-2`, which is ugly and honest.
 *
 * `taken` is the existing slug → root index, so a root that already has a slug
 * keeps it: minting is idempotent, and a URL someone bookmarked stays valid for
 * as long as the project is in the index.
 */
export const mintSlug = (root: string, taken: Readonly<Record<string, string>>): string => {
  for (const [slug, held] of Object.entries(taken)) if (held === root) return slug;
  const base = slugify(nameOfRoot(root));
  if (taken[base] === undefined) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}-${n}`;
    if (taken[candidate] === undefined) return candidate;
  }
  // A thousand projects of one name is not a case worth a cleverer answer, but
  // it must still terminate with something unique.
  return `${base}-${Date.now().toString(36)}`;
};
