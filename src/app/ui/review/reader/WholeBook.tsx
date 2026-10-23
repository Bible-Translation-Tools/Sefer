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

interface ChapterStep {
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly first: boolean;
  readonly last: boolean;
}

interface WholeBookProps {
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
}

function WholeBookCrumbs(props: { readonly book: WholeBookProps; readonly held: () => Prepared }) {
  return (
    <LocationStrip testId="review-location" class="rounded-md border">
      <Crumbs
        book={props.held().book.name}
        books={() =>
          props.book.books.map((entry) => ({
            id: entry.book.bookId,
            name: entry.book.name,
            count: entry.shown.length,
          }))
        }
        currentBook={props.held().book.bookId}
        onBook={(picked) => props.book.onBook(picked.id)}
        chapter={props.book.chapterLabel}
        chapters={() => props.book.chaptersOf(props.held())}
        currentChapter={props.book.currentChapter}
        onChapter={props.book.onChapter}
        step={props.book.chapterStep}
        end={
          <FollowToggle
            testId="review-linked"
            following={props.book.linked()}
            tooltipSide="bottom"
            stopLabel={t("Scroll the two texts separately")}
            startLabel={t("Keep the two texts at the same verse")}
            onToggle={props.book.onToggleLinked}
          />
        }
      />
    </LocationStrip>
  );
}

export function WholeBook(props: WholeBookProps): JSX.Element {
  let last = untrack(() => props.selected);
  const held = (): Prepared => {
    const found = props.selected;
    if (found !== undefined) last = found;
    if (last === undefined) throw new Error("Whole book is showing no book");
    return last;
  };
  return (
    <div class="flex min-h-0 flex-1 flex-col gap-2">
      <WholeBookCrumbs book={props} held={held} />

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
