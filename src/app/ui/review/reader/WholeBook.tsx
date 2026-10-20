import type { BookId } from "@sefer/text/book";
import type { JSX } from "@solidjs/web";
import { Show, untrack } from "solid-js";

import type { DecisionUnit } from "#core/galley";

import { t } from "../../../i18n";
import { BookDiff, type BookDiffApi, type Controls } from "../../diff";
import type { CrumbChapter } from "../../workspace/Crumbs";
import { Crumbs, LocationStrip } from "../../workspace/Crumbs";
import { FollowToggle } from "../../workspace/FollowToggle";
import type { LiveHandle } from "./createSeats";
import type { Observability, Prepared } from "./types";

export interface ChapterStep {
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly first: boolean;
  readonly last: boolean;
}

export function WholeBook(props: {
  readonly selected: Prepared | undefined;
  readonly books: readonly Prepared[];
  readonly ready: boolean;
  readonly split: boolean;
  readonly usfm: boolean;
  readonly linked: () => boolean;
  readonly onToggleLinked: () => void;
  readonly controls: (bookId: BookId) => Controls | undefined;
  readonly currentLabel: (bookId: BookId) => string;
  readonly baselineLabel: (bookId: BookId) => string;
  readonly currentFirst: boolean;
  readonly observability: Observability;
  readonly initial: DecisionUnit | undefined;
  readonly liveFor: (bookId: BookId) => LiveHandle | undefined;
  readonly awaitLive: boolean;
  readonly onApi: (api: BookDiffApi | undefined) => void;
  readonly onPlace: (unit: DecisionUnit | undefined) => void;
  readonly onBook: (bookId: BookId) => void;
  readonly chapterLabel: string;
  readonly currentChapter: number | undefined;
  readonly chaptersOf: (held: Prepared) => readonly CrumbChapter[];
  readonly onChapter: (chapter: number) => void;
  readonly chapterStep: ChapterStep;
}): JSX.Element {
  let last = untrack(() => props.selected);
  const held = (): Prepared => {
    const found = props.selected;
    if (found !== undefined) last = found;
    if (last === undefined) throw new Error("Whole book is showing no book");
    return last;
  };
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2">
      <LocationStrip testId="review-location" class="rounded-md border">
        <Crumbs
          book={held().book.name}
          books={() =>
            props.books.map((entry) => ({
              id: entry.book.bookId,
              name: entry.book.name,
              count: entry.shown.length,
            }))
          }
          currentBook={held().book.bookId}
          onBook={(picked) => props.onBook(picked.id)}
          chapter={props.chapterLabel}
          chapters={() => props.chaptersOf(held())}
          currentChapter={props.currentChapter}
          onChapter={props.onChapter}
          step={props.chapterStep}
          end={
            <FollowToggle
              testId="review-linked"
              following={props.linked()}
              tooltipSide="bottom"
              stopLabel={t("Scroll the two texts separately")}
              startLabel={t("Keep the two texts at the same verse")}
              onToggle={props.onToggleLinked}
            />
          }
        />
      </LocationStrip>

      <Show when={props.ready}>
        <BookDiff
          class="min-h-0 flex-1"
          linked={props.linked}
          sides={held().sides}
          units={held().units}
          split={props.split}
          usfm={props.usfm}
          controls={props.controls(held().book.bookId)}
          currentLabel={props.currentLabel(held().book.bookId)}
          baselineLabel={props.baselineLabel(held().book.bookId)}
          currentFirst={props.currentFirst}
          observability={props.observability}
          initial={props.initial}
          live={props.liveFor(held().book.bookId)}
          awaitLive={props.awaitLive}
          ref={(api) => props.onApi(api)}
          onPlace={props.onPlace}
        />
      </Show>
    </div>
  );
}
