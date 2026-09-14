/**
 * Key terms (STET): the same multibuffer, fed by a term's occurrences.
 *
 * Left, the term list from the mockup — term in bold with a done/total count,
 * and an expanded card showing the glosses and the references. Right, the
 * excerpt list, where every excerpt renders a PAIR: the source verse above and
 * the target verse below, and the target is the editable one.
 *
 * The source card is the honest part of this screen. A source verse comes from
 * a resource bound to the project under the `source` role
 * (`src/app/workflows/stet.ts`); the dev fixture has none, so the card says "no
 * source text bound" rather than showing the project's own text twice and
 * calling one of them a source. The seam is `sourceOf`: give this component a
 * function that answers with a passage and the card fills in, whoever read the
 * bytes.
 */

import type { JSX } from "@solidjs/web";
import BookmarkIcon from "lucide-solid/icons/bookmark";
import { For, Show, createMemo, createSignal } from "solid-js";

import type { BookId } from "../../../core/book/book";
import type { BookExcerpts, Excerpt, OutlineRow } from "../../../core/excerpts/excerpts";
import type { Analysis } from "../../../core/galley";
import type { EditorBook } from "../../../editor";
import { t } from "../../i18n";
import type { Term } from "../../workflows/stet";
import { Badge, Card, Switch, cx } from "../primitives";
import { ExcerptList } from "./ExcerptList";

export interface StetViewProps {
  readonly terms: readonly Term[];
  readonly selected: string;
  readonly onSelect: (id: string) => void;

  readonly groups: readonly BookExcerpts[];
  readonly outline: readonly OutlineRow[];
  readonly onOpen: (bookId: BookId, from: number) => void;
  readonly seat: (bookId: BookId) => Promise<EditorBook | undefined>;
  readonly analyze: (text: string) => Analysis;
  readonly onEdited?: () => void;

  /** The source reading for one excerpt, when a source resource is bound. */
  readonly sourceOf?: (excerpt: Excerpt) => string | undefined;
  /** Shown once, above the list, when the term list is a stand-in. */
  readonly standIn?: boolean;
}

const VISIBLE_REFERENCES = 6;

export function StetView(props: StetViewProps) {
  const [showAll, setShowAll] = createSignal(false, { name: "stetShowAll" });

  const references = createMemo(
    () => props.groups.flatMap((group) => group.excerpts.map((excerpt) => excerpt.label)),
    { name: "stetReferences" },
  );

  const total = (): number => props.groups.reduce((sum, group) => sum + group.count, 0);

  const pair = (excerpt: Excerpt): JSX.Element => (
    <div class="flex items-start gap-2">
      <BookmarkIcon size={14} class="mt-0.5 shrink-0 text-on-surface-tertiary" aria-hidden="true" />
      <div class="min-w-0">
        <span class="text-small font-medium text-on-surface-secondary">
          {t("{ref} —", { ref: excerpt.label })}
        </span>{" "}
        <Show
          when={props.sourceOf?.(excerpt)}
          fallback={
            <span class="text-small text-on-surface-tertiary italic">
              {t("No source text bound")}
            </span>
          }
        >
          {(text) => (
            <span class="font-scripture text-small text-on-surface-secondary">{text()}</span>
          )}
        </Show>
      </div>
    </div>
  );

  return (
    <div class="flex min-h-0 flex-1 gap-4">
      <aside class="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto">
        <Show when={props.standIn === true}>
          <p class="rounded-md bg-surface-warning px-3 py-2 text-smallest text-on-surface-warning">
            {t("No key-terms resource is bound; these terms are a stand-in.")}
          </p>
        </Show>
        <For each={props.terms}>
          {(term) => (
            <Card
              padded={false}
              data-term={term.id}
              class={cx(
                "cursor-pointer transition-colors",
                props.selected === term.id ? "border-brand" : "hover:border-surface-border-strong",
              )}
              onClick={() => props.onSelect(term.id)}
            >
              <div class="flex items-center gap-2 px-3 py-2">
                <strong class="text-small font-semibold text-on-surface-primary">
                  {term.term}
                </strong>
                {/* Only the open term has a count: the others have not been
                    searched, and a placeholder pill would read as a zero. */}
                <Show when={props.selected === term.id}>
                  <Badge tone="brand" class="ms-auto">
                    {t("{done}/{total}", { done: term.done, total: total() })}
                  </Badge>
                </Show>
              </div>

              <Show when={props.selected === term.id}>
                <div class="space-y-2 border-t border-surface-border px-3 py-2">
                  <p class="text-smallest text-on-surface-tertiary">{t("This word can mean:")}</p>
                  <ul class="list-disc space-y-0.5 ps-4 text-small text-on-surface-secondary">
                    <For each={term.glosses}>{(gloss) => <li>{gloss}</li>}</For>
                  </ul>
                  <ul class="space-y-0.5 text-smallest text-on-surface-tertiary">
                    <For
                      each={showAll() ? references() : references().slice(0, VISIBLE_REFERENCES)}
                    >
                      {(label) => <li class="truncate">{label}</li>}
                    </For>
                  </ul>
                  <Show when={references().length > VISIBLE_REFERENCES}>
                    <Switch
                      checked={showAll()}
                      onChange={setShowAll}
                      label={t("Show all references ({count})", { count: references().length })}
                    />
                  </Show>
                </div>
              </Show>
            </Card>
          )}
        </For>
      </aside>

      <ExcerptList
        groups={props.groups}
        outline={props.outline}
        onOpen={props.onOpen}
        seat={props.seat}
        analyze={props.analyze}
        onEdited={props.onEdited}
        renderPair={pair}
        empty={
          <p class="text-small text-on-surface-tertiary">
            {t("No occurrences of this term in the project.")}
          </p>
        }
      />
    </div>
  );
}
