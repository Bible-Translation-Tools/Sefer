import { createFileRoute, lazyRouteComponent, notFound } from "@tanstack/solid-router";

const loadHistoryDiff = async () => {
  if (__SEFER_DESIGN__) {
    const page = await import("#dev/playground/HistoryDiffPage");
    return { default: page.HistoryDiffPage };
  }
  throw notFound();
};

interface HistoryDiffSearch {
  readonly project?: string;
  readonly book?: string;
  readonly at?: string;
  readonly remote?: string;
}

const stringOr = (value: unknown): string | undefined => {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  return undefined;
};

export const Route = createFileRoute("/_app/playground/history-diff")({
  beforeLoad: () => {
    if (!__SEFER_DESIGN__) throw notFound();
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
