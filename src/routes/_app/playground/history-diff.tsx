import { createFileRoute, lazyRouteComponent, notFound } from "@tanstack/solid-router";

const loadHistoryDiff = async () => {
  if (import.meta.env.DEV) {
    const page = await import("#dev/playground/HistoryDiffPage");
    return { default: page.HistoryDiffPage };
  }
  throw notFound();
};

/**
 * Where in a book's history the page is: `project` and `book` pick the file,
 * `at` the change on screen (a commit id, or a prefix of one), and `remote`
 * the origin it came from, so a recipient without the project knows what to
 * clone. Anything malformed is dropped: a stale link opens the page.
 */
interface HistoryDiffSearch {
  readonly project?: string;
  readonly book?: string;
  readonly at?: string;
  readonly remote?: string;
}

// A commit prefix that happens to be all digits arrives as a NUMBER when a
// link was typed by hand (the router reads search values as JSON, and quotes
// its own); it is still the prefix it spells.
const stringOr = (value: unknown): string | undefined =>
  typeof value === "number" && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === "string" && value.trim() !== ""
      ? value.trim()
      : undefined;

export const Route = createFileRoute("/_app/playground/history-diff")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  validateSearch: (search: Record<string, unknown>): HistoryDiffSearch => {
    const project = stringOr(search.project);
    const book = stringOr(search.book);
    const at = stringOr(search.at);
    const remote = stringOr(search.remote);
    return {
      ...(project === undefined ? {} : { project }),
      ...(book === undefined ? {} : { book }),
      ...(at !== undefined && /^[0-9a-f]{4,40}$/u.test(at) ? { at } : {}),
      ...(remote !== undefined && /^https?:\/\//u.test(remote) ? { remote } : {}),
    };
  },
  head: () => ({ meta: [{ title: "Sefer — book history prototype" }] }),
  component: lazyRouteComponent(loadHistoryDiff),
});
