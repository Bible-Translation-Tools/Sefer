import type { BookId } from "@sefer/text/book";

import type { DecisionUnit } from "#core/galley";

import { t } from "../../../i18n";
import type { CrumbChapter } from "../../workspace/Crumbs";
import type { Filter, Layout, Prepared } from "./types";

export const stepTarget = (
  held: number | undefined,
  at: number | undefined,
  from: number,
  delta: number,
  last: number,
): number => {
  if (held === undefined && delta > 0)
    return at === undefined ? from : Math.min(last, from + delta);
  return Math.max(0, Math.min(last, from + delta));
};

export const viewLabel = (filter: Filter): string => {
  if (filter === "all") return t("View");
  return filter === "words" ? t("View · words only") : t("View · markup only");
};

export const filterLabel = (filter: Filter): string => {
  if (filter === "all") return t("All changes");
  return filter === "words" ? t("Changes to the words") : t("Markup and spacing only");
};

export const labelOf = (label: string | ((bookId: BookId) => string), bookId: BookId): string =>
  typeof label === "string" ? label : label(bookId);

export const toLayout = (value: string): Layout =>
  value === "split" || value === "unified" ? value : "auto";

export const chapterOf = (unit: DecisionUnit): number => {
  const addr = unit.currentAddr ?? unit.baselineAddr;
  return addr === undefined || addr.kind === "frontMatter" ? 0 : addr.chapter;
};

export const chaptersOf = (held: Prepared): readonly CrumbChapter[] => {
  const counts = new Map<number, number>();
  for (const unit of held.shown) {
    const chapter = chapterOf(unit);
    counts.set(chapter, (counts.get(chapter) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => a[0] - b[0])
    .map(([chapter, count]) => ({
      ordinal: chapter,
      label: chapter === 0 ? t("Intro") : String(chapter),
      intro: chapter === 0,
      count,
    }));
};

export const chapterWords = (chapter: number | undefined): string => {
  if (chapter === undefined) return "";
  return chapter === 0 ? t("Intro") : t("Chapter {label}", { label: chapter });
};

export const changeCount = (count: number): string =>
  t(count === 1 ? "{count} change" : "{count} changes", { count });

export const bookCount = (count: number): string =>
  t(count === 1 ? "{count} book" : "{count} books", { count });

export const visibleCardIndex = (
  root: HTMLElement | undefined,
  keys: readonly string[],
): number | undefined => {
  if (root === undefined) return undefined;
  const top = root.getBoundingClientRect().top;
  const index = new Map(keys.map((key, at) => [key, at]));
  let best: number | undefined;
  for (const card of root.querySelectorAll<HTMLElement>("[data-diff-card]")) {
    const at = index.get(card.dataset["diffCard"] ?? "");
    if (at === undefined || card.getBoundingClientRect().bottom <= top + 8) continue;
    if (best === undefined || at < best) best = at;
  }
  return best;
};

export const cardOnScreen = (root: HTMLElement | undefined, key: string | undefined): boolean => {
  if (root === undefined || key === undefined) return false;
  const card = root.querySelector<HTMLElement>(`[data-diff-card="${CSS.escape(key)}"]`);
  if (card === null) return false;
  const box = card.getBoundingClientRect();
  const frame = root.getBoundingClientRect();
  return box.bottom > frame.top + 8 && box.top < frame.bottom - 8;
};
