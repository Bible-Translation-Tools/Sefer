/**
 * Choosing between candidates for one book: the designer's "Choose a
 * Repository", plus the health line and "Differences from".
 *
 * A tab per candidate (the owner, ★ for Primary). Under it, one line of
 * facts: the date, Recommended when it is Primary, and its census against
 * the source text's ("5 ch · 124 v · English ULB has 5 ch · 105 v"). The body
 * is the book read as text, or — with "Differences from" set — Review's own
 * reader over the two candidates, before there is any project.
 *
 * The 1 John case reads in a second: the Primary has 124 verses where the
 * source text has 105, and the differences show Jude's text in it.
 */

import { Result } from "effect";
import ChevronLeft from "lucide-solid/icons/chevron-left";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import { diffSkeleton } from "#core/diff/skeleton";
import { CANON } from "#core/location/canon";
import { candidateLabel, type BookCandidate } from "#core/migrate/candidate";
import type { Health } from "#core/migrate/check";

import { t } from "../../i18n";
import { sourceCensus, type Opened } from "../../migrate";
import { useShell } from "../../ProjectContext";
import { Badge, Button, Card, Select } from "../primitives";
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

export function ChooseStep(props: {
  readonly book: string;
  readonly candidates: readonly BookCandidate[];
  readonly opened: (id: string) => Opened;
  readonly initial: string | undefined;
  readonly position: { readonly index: number; readonly total: number };
  readonly onStep: (delta: number) => void;
  readonly onUse: (id: string) => void;
  readonly onBack: () => void;
}) {
  const shell = useShell();
  const { services } = shell;
  const [tab, setTab] = createSignal<string | undefined>(undefined, { name: "chooseTab" });
  const [against, setAgainst] = createSignal("", { name: "chooseAgainst" });
  const [source, setSource] = createSignal<
    { readonly title: string; readonly health: Health } | undefined
  >(undefined, { name: "chooseSource" });
  const [usfm, setUsfm] = createSignal(false, { name: "chooseUsfm" });

  const current = (): BookCandidate | undefined =>
    props.candidates.find((candidate) => candidate.id === (tab() ?? props.initial)) ??
    props.candidates[0];

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

  /** The current tab's census, and whether it disagrees with the source text's. */
  const health = createMemo(
    (): { readonly text: string; readonly off: boolean } => {
      const id = current()?.id;
      const held = id === undefined ? undefined : props.opened(id);
      if (held?.state === "refused")
        return { text: t("refused: {reason}", { reason: held.reason }), off: true };
      if (held?.state !== "ready") return { text: t("Checking…"), off: false };
      const expected = source()?.health;
      return {
        text: healthLine(held.health),
        off:
          expected !== undefined &&
          (expected.chapters !== held.health.chapters || expected.verses !== held.health.verses),
      };
    },
    { name: "chooseHealth" },
  );

  const textOf = (id: string): string | undefined => {
    const held = props.opened(id);
    return held.state === "ready" ? held.staged.usfm : undefined;
  };

  /** Review's reader over two candidates: this one on the right, the other on the left. */
  const compared = createMemo(
    (): readonly ReviewBook[] => {
      const left = against();
      const right = current()?.id;
      if (left === "" || right === undefined) return [];
      const baseline = textOf(left);
      const working = textOf(right);
      if (baseline === undefined || working === undefined) return [];
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
    { name: "chooseCompared" },
  );

  const labelOf = (id: string): string => {
    const candidate = props.candidates.find((each) => each.id === id);
    return candidate === undefined ? "" : candidateLabel(candidate);
  };

  return (
    <Card padded={false} class="flex min-h-0 flex-col overflow-hidden">
      <div class="flex flex-wrap items-center gap-3 border-b border-surface-border px-4 py-3">
        <Button
          size="sm"
          variant="tertiary"
          icon={<ChevronLeft aria-hidden="true" />}
          onClick={() => props.onBack()}
        >
          {t("Books")}
        </Button>
        <span class="me-auto text-h4 font-semibold">{name()}</span>
        <span class="text-small text-on-surface-tertiary">
          {t("{index} of {total} to choose", {
            index: props.position.index + 1,
            total: props.position.total,
          })}
        </span>
        <Button size="sm" variant="tertiary" onClick={() => props.onStep(-1)}>
          {t("Previous")}
        </Button>
        <Button size="sm" variant="tertiary" onClick={() => props.onStep(1)}>
          {t("Next")}
        </Button>
      </div>

      <div role="tablist" class="flex flex-wrap border-b border-surface-border">
        <For each={props.candidates}>
          {(candidate) => (
            <button
              type="button"
              role="tab"
              data-testid={`choose-tab-${candidateLabel(candidate)}`}
              aria-selected={current()?.id === candidate.id ? "true" : "false"}
              class={
                current()?.id === candidate.id
                  ? "px-4 py-2 text-small font-semibold shadow-[inset_0_-2px_currentColor]"
                  : "px-4 py-2 text-small text-on-surface-secondary"
              }
              onClick={() => {
                setTab(candidate.id);
                if (against() === candidate.id) setAgainst("");
              }}
            >
              {candidateLabel(candidate)}
              {candidate.hints.status === "Primary" ? " ★" : ""}
            </button>
          )}
        </For>
      </div>

      <Show when={current()}>
        {(candidate) => (
          <>
            <div
              data-testid="choose-health"
              class="flex flex-wrap items-center gap-2 border-b border-surface-border px-4 py-2 text-small text-on-surface-secondary"
            >
              <Show when={candidate().hints.modified}>
                {(modified) => <span>{modified().slice(0, 10)}</span>}
              </Show>
              <Show when={candidate().hints.status === "Primary"}>
                <Badge tone="brand">{t("Recommended")}</Badge>
              </Show>
              <span class={health().off ? "font-semibold text-on-surface-error" : ""}>
                {health().text}
              </span>
              <Show when={source()}>
                {(found) =>
                  t("· {title} has {chapters} ch · {verses} v", {
                    title: found().title,
                    chapters: found().health.chapters,
                    verses: found().health.verses,
                  })
                }
              </Show>
            </div>

            <div class="flex flex-wrap items-center gap-3 border-b border-surface-border px-4 py-2 text-small">
              <label class="flex items-center gap-2">
                {t("Differences from")}
                <Select
                  size="sm"
                  value={against()}
                  onChange={(event) => setAgainst(event.currentTarget.value)}
                >
                  <option value="">{t("— none —")}</option>
                  <For each={props.candidates.filter((each) => each.id !== candidate().id)}>
                    {(other) => <option value={other.id}>{candidateLabel(other)}</option>}
                  </For>
                </Select>
              </label>
              <Button
                variant="primary"
                size="sm"
                class="ms-auto"
                data-testid="choose-use"
                disabled={props.opened(candidate().id).state !== "ready"}
                onClick={() => props.onUse(candidate().id)}
              >
                {t("Use this one")}
              </Button>
            </div>

            <Show
              when={against() !== "" && compared().length > 0}
              fallback={
                <div class="max-h-[60vh] overflow-y-auto px-6 py-4 font-scripture">
                  <For each={reading(textOf(candidate().id) ?? "")}>
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
              <div class="flex h-[60vh] min-h-0 flex-col">
                <ReviewReader
                  books={compared()}
                  decision={() => undefined}
                  decide={() => {}}
                  decidable={false}
                  claimSidebar={false}
                  usfm={usfm()}
                  onUsfm={setUsfm}
                  currentLabel={labelOf(candidate().id)}
                  baselineLabel={labelOf(against())}
                  currentShort={labelOf(candidate().id)}
                  baselineShort={labelOf(against())}
                  selected={props.book}
                  onSelect={() => {}}
                  seat={() => Promise.resolve(undefined)}
                  onEdited={() => {}}
                />
              </div>
            </Show>
          </>
        )}
      </Show>
    </Card>
  );
}
