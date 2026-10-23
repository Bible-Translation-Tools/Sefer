import type { EditorBook } from "@sefer/editor";
import type { BookId } from "@sefer/text/book";
import type { JSX } from "@solidjs/web";
import BookOpen from "lucide-solid/icons/book-open";

import type { Analysis } from "#core/galley";

import { t } from "../../../i18n";
import { DiffCard, type Controls, type Hunk } from "../../diff";
import type { CardAction } from "../../multibuffer/CardAction";
import { CardList } from "../../multibuffer/CardList";
import type { ContextStep } from "../../multibuffer/cardState";
import { EmptyState, type VirtualSection } from "../../primitives";
import { labelOf } from "./helpers";
import type { CardViews, Prepared } from "./types";

export interface CardItem {
  readonly hunk: Hunk;
  readonly held: Prepared;
}

interface ChangeCardsProps {
  readonly sections: readonly VirtualSection<CardItem>[];
  readonly preparing: boolean;
  readonly views: CardViews;
  readonly split: boolean;
  readonly usfm: boolean;
  readonly controls: (bookId: BookId) => Controls | undefined;
  readonly isCurrent: (key: string) => boolean;
  readonly originOf?: (
    bookId: BookId,
    units: Hunk["units"],
  ) => "there" | "here" | "both" | undefined;
  readonly currentLabel: string | ((bookId: BookId) => string);
  readonly baselineLabel: string | ((bookId: BookId) => string);
  readonly currentFirst: boolean;
  readonly sides?: (
    hunk: Hunk,
    split: boolean,
  ) => {
    readonly baseline: readonly CardAction[];
    readonly current: readonly CardAction[];
    readonly below?: JSX.Element;
  };
  readonly editable: boolean;
  readonly seat: (bookId: BookId) => Promise<EditorBook | undefined>;
  readonly analyze: (bookId: BookId, text: string) => Analysis;
  readonly headerActions: (hunk: Hunk) => readonly CardAction[];
  readonly onStep: (key: string, step: ContextStep) => void;
  readonly onOpen: (hunk: Hunk) => void;
  readonly onEditing: (editing: boolean) => void;
  readonly onRoot: (root: HTMLDivElement) => void;
  readonly onScrollTo: (scrollTo: (key: string) => void) => void;
}

export function ChangeCards(props: ChangeCardsProps): JSX.Element {
  return (
    <div class="flex min-h-0 flex-1" ref={(element) => props.onRoot(element)}>
      <CardList<CardItem>
        sections={props.sections}
        bookOf={(item) => item.hunk.bookId}
        seat={props.seat}
        lineLabel={(item) => item.hunk.label}
        goneLabel={t("No longer a change")}
        whenGone={(item) => ({ ...item, hunk: { ...item.hunk, units: [], all: [] } })}
        onEditing={(now) => props.onEditing(now)}
        ref={(scrollTo) => props.onScrollTo(scrollTo)}
        card={(item, _key, session) => (
          <DiffCard
            hunk={item().hunk}
            view={props.views.view(item().hunk.key)}
            onView={(event) => props.views.send(item().hunk.key, event)}
            sides={item().held.sides}
            split={props.split}
            usfm={props.usfm}
            controls={props.controls(item().hunk.bookId)}
            current={props.isCurrent(item().hunk.key)}
            origin={props.originOf?.(item().hunk.bookId, item().hunk.units)}
            currentLabel={labelOf(props.currentLabel, item().hunk.bookId)}
            baselineLabel={labelOf(props.baselineLabel, item().hunk.bookId)}
            currentFirst={props.currentFirst}
            sideActions={props.split ? props.sides?.(item().hunk, true) : undefined}
            below={props.sides?.(item().hunk, props.split).below}
            editable={props.editable}
            editing={session.editing}
            gone={session.gone ? session.goneLabel : undefined}
            onEdit={session.start}
            onDone={session.done}
            seat={() => props.seat(item().hunk.bookId)}
            analyze={(text) => props.analyze(item().hunk.bookId, text)}
            headerActions={props.headerActions(item().hunk)}
            onStep={(step) => props.onStep(item().hunk.key, step)}
            open={{
              kind: "icon",
              id: "open",
              label: t("Open in the book"),
              icon: BookOpen,
              onPress: () => props.onOpen(item().hunk),
            }}
          />
        )}
        empty={
          <EmptyState title={props.preparing ? t("Preparing…") : t("No changes of this kind.")} />
        }
      />
    </div>
  );
}
