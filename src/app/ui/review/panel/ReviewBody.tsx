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

export function ReviewBody(props: {
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
}) {
  return (
    <>
      <SyncLine
        comparison={
          props.compare.result() === undefined
            ? undefined
            : {
                changes: props.units.totals().total,
                books: props.compare.result()?.changedBooks ?? 0,
                decided: props.units.totals().decided,
              }
        }
        onSee={props.sides.seeShared}
        seeing={props.sides.againstShared()}
        onSeeWriter={() => props.sides.pick("right", "writer")}
        seeingWriter={props.sides.againstWriter()}
      />
      <Show when={props.route.pull()}>{(number) => <SuggestionLine number={number()} />}</Show>
      <Show when={props.route.pull() !== undefined && props.units.mineOnlyCount() > 0}>
        <p
          class="flex flex-wrap items-center gap-2 text-smallest text-on-surface-secondary"
          data-review-mine-only={props.units.mineOnlyCount()}
        >
          {t(
            "Your editor also has {count} change(s) that are not in this suggestion. They stay as they are.",
            { count: props.units.mineOnlyCount() },
          )}
          <Button size="sm" variant="tertiary" onClick={() => props.units.setShowMine((on) => !on)}>
            {props.units.showMine() ? t("Hide them") : t("Show them")}
          </Button>
        </p>
      </Show>
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
            {(what) => (
              <div
                class="flex items-center justify-center gap-2 py-10 text-small text-on-surface-secondary"
                role="status"
                data-review-waiting
              >
                <span
                  aria-hidden="true"
                  class="size-4 animate-spin rounded-full border-2 border-on-surface-tertiary border-t-transparent"
                />
                {t("Reading {source}…", { source: what() })}
              </div>
            )}
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
            <p class="text-smallest text-on-surface-secondary" data-review-one-sided>
              <Show
                when={props.emptySide}
                fallback={t(
                  "Only one side holds {books}. A project's book set is fixed when it opens, so Review cannot add or remove a book yet.",
                  {
                    books:
                      props.units.oneSided().length > 6
                        ? t("{count} books", { count: props.units.oneSided().length })
                        : props.units.oneSided().map(props.bookLabel).join(", "),
                  },
                )}
              >
                {(side) => t("{source} holds no books yet.", { source: side() })}
              </Show>
            </p>
          </Show>
          <Show when={props.settled && props.decisions.showChoices()}>
            <p class="flex items-center gap-2 text-smallest text-on-surface-secondary">
              <Check size={14} aria-hidden="true" class="text-on-surface-success" />
              {t("Every change is decided.")}
              <Button
                size="sm"
                variant="tertiary"
                onClick={() => props.decisions.setShowChoices(false)}
              >
                {t("Hide my choices")}
              </Button>
            </p>
          </Show>

          <Show when={props.settled && !props.decisions.showChoices()}>
            <EmptyState
              icon={<Check size={20} />}
              title={t("Every change is decided")}
              description={props.form.decidedDescription()}
              action={
                <div class="flex flex-wrap justify-center gap-2" data-review-settled>
                  <Show
                    when={
                      props.sides.target() !== undefined &&
                      (props.sides.againstShared() || props.form.unsaved().length > 0)
                    }
                  >
                    <Button variant="primary" icon={<Save />} onClick={props.form.openRecord}>
                      {t("Save")}
                    </Button>
                  </Show>
                  <Button variant="tertiary" onClick={() => props.decisions.setShowChoices(true)}>
                    {t("Show my choices")}
                  </Button>
                </div>
              }
            />
          </Show>
          <div
            class={[
              "flex min-h-0 flex-1 flex-col",
              { hidden: props.settled && !props.decisions.showChoices() },
            ]}
            data-review-units={props.units.totals().total}
          >
            <ReviewReader
              books={props.units.readerBooks()}
              originOf={props.units.originOf}
              decision={props.units.effectiveFor}
              decide={props.writes.decideAny}
              decidable={props.writes.editable()}
              usfm={props.usfm}
              onUsfm={props.onUsfm}
              currentLabel={props.sides.leftLabel()}
              baselineLabel={props.sides.rightLabel()}
              currentShort={props.sides.leftShort()}
              baselineShort={props.sides.rightShort()}
              selected={props.compare.selected()}
              onSelect={props.compare.setSelected}
              seat={props.writes.seatBook}
              onEdited={(bookId) => props.shell.changed({ kind: "book.apply", books: [bookId] })}
              onEditing={props.onEditing}
            />
          </div>
        </Show>
      </Show>{" "}
    </>
  );
}
