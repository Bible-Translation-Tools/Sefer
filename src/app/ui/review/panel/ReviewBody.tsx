import Check from "lucide-solid/icons/check";
import Save from "lucide-solid/icons/save";
import { Show } from "solid-js";

import type { BookComparison } from "#core/compare";

import { t } from "../../../i18n";
import type { Shell } from "../../../ProjectContext";
import { SyncLine } from "../../cloud/SyncLine";
import { Button, EmptyState } from "../../primitives";
import { RecoveryBanner } from "../../recovery/RecoveryBanner";
import { ReviewReader } from "../ReviewReader";
import { SuggestionLine } from "../SuggestionLine";
import type { Compare } from "./createCompare";
import type { Decisions } from "./createDecisions";
import type { ReviewRoute } from "./createReviewRoute";
import type { SaveForm } from "./createSaveForm";
import type { Sides } from "./createSides";
import type { Units } from "./createUnits";
import type { Writes } from "./createWrites";
import { SuggestionHere } from "./SuggestionHere";

interface ReviewBodyProps {
  readonly shell: Shell;
  readonly route: ReviewRoute;
  readonly sides: Sides;
  readonly compare: Compare;
  readonly units: Units;
  readonly decisions: Decisions;
  readonly form: SaveForm;
  readonly writes: Writes;
  readonly settled: boolean;
  readonly cardEditing: boolean;
  readonly emptySide: string | undefined;
  readonly bookLabel: (book: BookComparison) => string;
  readonly usfm: boolean;
  readonly onUsfm: (on: boolean) => void;
  readonly onEditing: (editing: boolean) => void;
}

function ReviewNotices(props: { readonly body: ReviewBodyProps }) {
  return (
    <>
      <SyncLine
        comparison={
          props.body.compare.result() === undefined
            ? undefined
            : {
                changes: props.body.units.totals().total,
                books: props.body.compare.result()?.changedBooks ?? 0,
                decided: props.body.units.totals().decided,
              }
        }
        onSee={props.body.sides.seeShared}
        seeing={props.body.sides.againstShared()}
        onSeeWriter={() => props.body.sides.pick("right", "writer")}
        seeingWriter={props.body.sides.againstWriter()}
      />
      <Show when={props.body.route.pull()}>{(number) => <SuggestionLine number={number()} />}</Show>
      <Show when={props.body.route.pull() !== undefined && props.body.units.mineOnlyCount() > 0}>
        <p
          class="flex flex-wrap items-center gap-2 text-smallest text-on-surface-secondary"
          data-review-mine-only={props.body.units.mineOnlyCount()}
        >
          {t(
            "Your editor also has {count} change(s) that are not in this suggestion. They stay as they are.",
            { count: props.body.units.mineOnlyCount() },
          )}
          <Button
            size="sm"
            variant="tertiary"
            onClick={() => props.body.units.setShowMine((on) => !on)}
          >
            {props.body.units.showMine() ? t("Hide them") : t("Show them")}
          </Button>
        </p>
      </Show>
    </>
  );
}

function WaitingStatus(props: { readonly what: string }) {
  return (
    <div
      class="flex items-center justify-center gap-2 py-10 text-small text-on-surface-secondary"
      role="status"
      data-review-waiting
    >
      <span
        aria-hidden="true"
        class="size-4 animate-spin rounded-full border-2 border-on-surface-tertiary border-t-transparent"
      />
      {t("Reading {source}…", { source: props.what })}
    </div>
  );
}

function OneSidedNote(props: { readonly body: ReviewBodyProps }) {
  return (
    <p class="text-smallest text-on-surface-secondary" data-review-one-sided>
      <Show
        when={props.body.emptySide}
        fallback={t(
          "Only one side holds {books}. A project's book set is fixed when it opens, so Review cannot add or remove a book yet.",
          {
            books:
              props.body.units.oneSided().length > 6
                ? t("{count} books", { count: props.body.units.oneSided().length })
                : props.body.units.oneSided().map(props.body.bookLabel).join(", "),
          },
        )}
      >
        {(side) => t("{source} holds no books yet.", { source: side() })}
      </Show>
    </p>
  );
}

function SettledNotice(props: { readonly body: ReviewBodyProps }) {
  return (
    <>
      <Show when={props.body.settled && props.body.decisions.showChoices()}>
        <p class="flex items-center gap-2 text-smallest text-on-surface-secondary">
          <Check size={14} aria-hidden="true" class="text-on-surface-success" />
          {t("Every change is decided.")}
          <Button
            size="sm"
            variant="tertiary"
            onClick={() => props.body.decisions.setShowChoices(false)}
          >
            {t("Hide my choices")}
          </Button>
        </p>
      </Show>

      <Show when={props.body.settled && !props.body.decisions.showChoices()}>
        <EmptyState
          icon={<Check size={20} />}
          title={t("Every change is decided")}
          description={props.body.form.decidedDescription()}
          action={
            <div class="flex flex-wrap justify-center gap-2" data-review-settled>
              <Show
                when={
                  props.body.sides.target() !== undefined &&
                  (props.body.sides.againstShared() || props.body.form.unsaved().length > 0)
                }
              >
                <Button variant="primary" icon={<Save />} onClick={props.body.form.openRecord}>
                  {t("Save")}
                </Button>
              </Show>
              <Button variant="tertiary" onClick={() => props.body.decisions.setShowChoices(true)}>
                {t("Show my choices")}
              </Button>
            </div>
          }
        />
      </Show>
    </>
  );
}

function ReaderRegion(props: { readonly body: ReviewBodyProps }) {
  return (
    <div
      class={[
        "flex min-h-0 flex-1 flex-col",
        { hidden: props.body.settled && !props.body.decisions.showChoices() },
      ]}
      data-review-units={props.body.units.totals().total}
    >
      <ReviewReader
        books={props.body.units.readerBooks()}
        originOf={props.body.units.originOf}
        decision={props.body.units.effectiveFor}
        decide={props.body.writes.decideAny}
        decidable={props.body.writes.editable()}
        usfm={props.body.usfm}
        onUsfm={props.body.onUsfm}
        currentLabel={props.body.sides.leftLabel()}
        baselineLabel={props.body.sides.rightLabel()}
        currentShort={props.body.sides.leftShort()}
        baselineShort={props.body.sides.rightShort()}
        selected={props.body.compare.selected()}
        onSelect={props.body.compare.setSelected}
        seat={props.body.writes.seatBook}
        onEdited={(bookId) => props.body.shell.changed({ kind: "book.apply", books: [bookId] })}
        onEditing={props.body.onEditing}
      />
    </div>
  );
}

export function ReviewBody(props: ReviewBodyProps) {
  return (
    <>
      <ReviewNotices body={props} />
      <RecoveryBanner />
      <Show
        when={props.compare.result()}
        fallback={
          <Show
            when={
              props.sides.waitingFor() ?? (props.compare.comparing() ? t("both sides") : undefined)
            }
            fallback={<EmptyState title={t("Nothing to review yet.")} />}
          >
            {(what) => <WaitingStatus what={what()} />}
          </Show>
        }
      >
        <Show
          when={props.compare.changed().length > 0 || props.cardEditing}
          fallback={
            <Show
              when={props.route.pull() !== undefined}
              fallback={
                <EmptyState
                  icon={<Check size={20} />}
                  title={t("No differences.")}
                  description={t("Both sides hold exactly the same books and text.")}
                />
              }
            >
              <SuggestionHere />
            </Show>
          }
        >
          <Show
            when={
              props.route.pull() !== undefined &&
              !props.units.showMine() &&
              props.units.offeredCount() === 0 &&
              !props.cardEditing
            }
          >
            <SuggestionHere />
          </Show>
          <Show when={props.units.oneSided().length > 0}>
            <OneSidedNote body={props} />
          </Show>
          <SettledNotice body={props} />
          <ReaderRegion body={props} />
        </Show>
      </Show>{" "}
    </>
  );
}
