/**
 * One book's candidates, all at a glance: the main pane of the assembling
 * step, beside the book list.
 *
 * A table row per candidate — who, status, last updated, health against the
 * source text, and how many passages differ from the one picked — with a
 * radio to use it. The point is that the facts decide (Will, 2026-10-07):
 * "surface the info so it's obv who, status, and last_updated, health, to try
 * to minimize any time needing to see differences". The Recommended one
 * (Primary, then the newest Active) is picked until the person picks another.
 *
 * Below the table, the picked book read as text; or, with Compare on a row,
 * Review's reader over the picked one and that one. N-way is two-way in a
 * loop: the count column is every candidate against the pick, and Compare
 * opens one pair.
 *
 * The 1 John case reads in a second: the Primary has 124 verses where the
 * source text has 105, and comparing it shows Jude's text in it.
 */

import { CANON } from "@sefer/text/location/canon";
import { Result } from "effect";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import { diffSkeleton } from "#core/diff/skeleton";
import { candidateLabel, type BookCandidate } from "#core/migrate/candidate";
import type { Health } from "#core/migrate/check";

import { t } from "../../i18n";
import { passagesDiffering, sourceCensus, type Opened } from "../../migrate";
import { useShell } from "../../ProjectContext";
import { formatDate } from "../landing/summaries";
import { Badge, Button, Card, cx } from "../primitives";
import { ReviewReader, type ReviewBook } from "../review/ReviewReader";
import { healthLine } from "./healthLine";

/** Chapters and verses out of USFM, for reading; every other marker is dropped. */
const reading = (
  usfm: string,
): readonly { chapter: string; verses: readonly [string, string][] }[] => {
  const out: { chapter: string; verses: [string, string][] }[] = [];
  for (const part of usfm.split(/\\c\s+/).slice(1)) {
    const chapter = /^(\d+)/.exec(part)?.[1] ?? "";
    const verses: [string, string][] = [];
    for (const verse of part.split(/\\v\s+/).slice(1)) {
      const number = /^(\S+)/.exec(verse)?.[1] ?? "";
      const text = verse
        .slice(number.length)
        .replace(/\\[a-z0-9]+\*?/gi, " ")
        .replace(/\s+/g, " ")
        .trim();
      verses.push([number, text]);
    }
    out.push({ chapter, verses });
  }
  return out;
};

const COLUMNS =
  "grid grid-cols-[2rem_minmax(12rem,1.5fr)_5rem_7rem_minmax(0,1fr)_9rem_5rem] items-center gap-x-4 px-4";

export function BookPane(props: {
  readonly book: string;
  readonly candidates: readonly BookCandidate[];
  readonly opened: (id: string) => Opened;
  /** The candidate the book will be assembled from. */
  readonly picked: string | undefined;
  /** What the rule would pick, marked Recommended. */
  readonly recommended: string | undefined;
  readonly onUse: (id: string) => void;
}) {
  const shell = useShell();
  const { services } = shell;
  /** The candidate compared against the pick; "" for none. */
  const [comparing, setComparing] = createSignal("", { name: "bookPaneComparing" });
  const [source, setSource] = createSignal<
    { readonly title: string; readonly health: Health } | undefined
  >(undefined, { name: "bookPaneSource" });
  const [usfm, setUsfm] = createSignal(false, { name: "bookPaneUsfm" });

  const name = (): string => CANON.find((entry) => entry.id === props.book)?.name ?? props.book;

  // The source text's census, once per book: the sources every candidate's
  // manifest lists, and the first one this device holds.
  createEffect(
    () =>
      props.candidates.flatMap((candidate) => {
        const held = props.opened(candidate.id);
        return held.state === "ready" ? held.staged.project.sources : [];
      }),
    (sources) => {
      void services.run(sourceCensus(services, sources, props.book)).then(setSource);
    },
  );

  const textOf = (id: string | undefined): string | undefined => {
    if (id === undefined) return undefined;
    const held = props.opened(id);
    return held.state === "ready" ? held.staged.usfm : undefined;
  };

  /** Per candidate, passages differing from the pick; two-way, in a loop. */
  const differing = createMemo(
    (): ReadonlyMap<string, number | undefined> => {
      const picked = textOf(props.picked);
      const out = new Map<string, number | undefined>();
      if (picked === undefined) return out;
      for (const candidate of props.candidates) {
        const text = textOf(candidate.id);
        if (text !== undefined) out.set(candidate.id, passagesDiffering(services, picked, text));
      }
      return out;
    },
    { name: "bookPaneDiffering" },
  );

  const healthOf = (id: string): { readonly text: string; readonly off: boolean } => {
    const held = props.opened(id);
    if (held.state === "refused")
      return { text: t("refused: {reason}", { reason: held.reason }), off: true };
    if (held.state !== "ready") return { text: t("Checking…"), off: false };
    const expected = source()?.health;
    return {
      text: healthLine(held.health),
      off:
        held.health.diagnostics.errors > 0 ||
        (expected !== undefined &&
          (expected.chapters !== held.health.chapters || expected.verses !== held.health.verses)),
    };
  };

  const differingText = (id: string): string => {
    if (id === props.picked) return t("picked");
    const count = differing().get(id);
    if (count === undefined) return "—";
    return count === 0 ? t("same text") : t("{count} passages", { count });
  };

  /** Review's reader: the pick on the right, the compared one on the left. */
  const compared = createMemo(
    (): readonly ReviewBook[] => {
      const left = comparing();
      const baseline = textOf(left === "" ? undefined : left);
      const working = textOf(props.picked);
      if (baseline === undefined || working === undefined || left === props.picked) return [];
      const skeleton = diffSkeleton(services.galley, props.book, baseline, working);
      if (Result.isFailure(skeleton)) return [];
      return [
        {
          bookId: props.book,
          name: name(),
          currentText: working,
          baselineText: baseline,
          skeleton: skeleton.success,
        },
      ];
    },
    { name: "bookPaneCompared" },
  );

  const labelOf = (id: string | undefined): string => {
    const candidate = props.candidates.find((each) => each.id === id);
    return candidate === undefined ? "" : candidateLabel(candidate);
  };

  return (
    <Card padded={false} class="flex min-h-0 min-w-0 flex-col overflow-hidden">
      <div class="flex flex-wrap items-baseline gap-3 border-b border-surface-border px-4 py-3">
        <span class="me-auto text-h4 font-semibold">{name()}</span>
        <Show when={source()}>
          {(found) => (
            <span class="text-small text-on-surface-secondary">
              {t("{title} has {chapters} ch · {verses} v", {
                title: found().title,
                chapters: found().health.chapters,
                verses: found().health.verses,
              })}
            </span>
          )}
        </Show>
      </div>

      <div role="table" aria-label={t("Candidates for {book}", { book: name() })}>
        <div
          role="row"
          class={cx(
            COLUMNS,
            "border-b border-surface-border py-2 text-small text-on-surface-secondary",
          )}
        >
          <span role="columnheader">
            <span class="sr-only">{t("Use")}</span>
          </span>
          <span role="columnheader">{t("Who")}</span>
          <span role="columnheader">{t("Status")}</span>
          <span role="columnheader">{t("Updated")}</span>
          <span role="columnheader">{t("Health")}</span>
          <span role="columnheader">{t("Differs from picked")}</span>
          <span role="columnheader">
            <span class="sr-only">{t("Compare")}</span>
          </span>
        </div>
        <For each={props.candidates}>
          {(candidate) => (
            <label
              role="row"
              data-testid={`candidate-${candidateLabel(candidate)}`}
              class={cx(
                COLUMNS,
                "cursor-pointer border-b border-surface-border py-2 text-small hover:bg-surface-secondary",
                props.picked === candidate.id && "bg-surface-secondary",
              )}
            >
              <span role="cell">
                <input
                  type="radio"
                  name={`use-${props.book}`}
                  checked={props.picked === candidate.id}
                  disabled={props.opened(candidate.id).state !== "ready"}
                  onChange={() => props.onUse(candidate.id)}
                />
              </span>
              <span role="cell" class="flex min-w-0 items-center gap-2">
                <span class="truncate font-medium">{candidateLabel(candidate)}</span>
                <Show when={props.recommended === candidate.id}>
                  <Badge tone="brand">{t("Recommended")}</Badge>
                </Show>
              </span>
              <span role="cell" class="text-on-surface-secondary">
                {candidate.hints.status ?? "—"}
              </span>
              <span role="cell" class="text-on-surface-secondary">
                {formatDate(candidate.hints.modified) || "—"}
              </span>
              <span
                role="cell"
                class={cx(
                  "truncate",
                  healthOf(candidate.id).off
                    ? "font-semibold text-on-surface-error"
                    : "text-on-surface-secondary",
                )}
                title={healthOf(candidate.id).text}
              >
                {healthOf(candidate.id).text}
              </span>
              <span role="cell" class="tabular-nums text-on-surface-secondary">
                {differingText(candidate.id)}
              </span>
              <span role="cell" class="text-end">
                <Show
                  when={
                    candidate.id !== props.picked &&
                    differing().get(candidate.id) !== undefined &&
                    differing().get(candidate.id) !== 0
                  }
                >
                  <Button
                    size="sm"
                    variant={comparing() === candidate.id ? "secondary" : "tertiary"}
                    onClick={(event) => {
                      event.preventDefault();
                      setComparing(comparing() === candidate.id ? "" : candidate.id);
                    }}
                  >
                    {comparing() === candidate.id ? t("Hide") : t("Compare")}
                  </Button>
                </Show>
              </span>
            </label>
          )}
        </For>
      </div>

      <Show
        when={compared().length > 0}
        fallback={
          <div class="max-h-[55vh] overflow-y-auto px-6 py-4 font-scripture">
            <For each={reading(textOf(props.picked) ?? "")}>
              {(chapter) => (
                <section class="mb-4">
                  <h3 class="mb-1 text-h4 font-bold">{chapter.chapter}</h3>
                  <p>
                    <For each={chapter.verses}>
                      {(verse) => (
                        <>
                          <sup class="me-0.5 text-on-surface-tertiary">{verse[0]}</sup>
                          {verse[1]}{" "}
                        </>
                      )}
                    </For>
                  </p>
                </section>
              )}
            </For>
          </div>
        }
      >
        <div class="flex h-[55vh] min-h-0 flex-col">
          <ReviewReader
            books={compared()}
            decision={() => undefined}
            decide={() => {}}
            decidable={false}
            claimSidebar={false}
            usfm={usfm()}
            onUsfm={setUsfm}
            currentLabel={labelOf(props.picked)}
            baselineLabel={labelOf(comparing())}
            currentShort={labelOf(props.picked)}
            baselineShort={labelOf(comparing())}
            selected={props.book}
            onSelect={() => {}}
            seat={() => Promise.resolve(undefined)}
            onEdited={() => {}}
          />
        </div>
      </Show>
    </Card>
  );
}
