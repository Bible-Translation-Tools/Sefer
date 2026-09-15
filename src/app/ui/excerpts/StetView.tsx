/**
 * Key terms (STET): the same multibuffer, fed by a term's occurrences.
 *
 * Left, the term list from the mockup — a search box over the guide, then a
 * card per term with its label in bold and a done/total count, and the open
 * term expanded to show its definition, its glosses and its references.
 * Right, the excerpt list, where every excerpt renders a PAIR: the source
 * verse above and the target verse below, and the target is the editable one.
 *
 * The source card is the honest part of this screen. Its reading is the
 * guide's own frozen text for that reference, with the guide's precomputed
 * gloss offsets highlighted; when the guide has no reading, a resource bound
 * to the project under the `source` role answers; when neither does, the card
 * says "no source text bound" rather than showing the project's own text twice
 * and calling one of them a source. `sourceOf` is that whole decision,
 * resolved by `src/app/workflows/stet.ts` before a card renders.
 *
 * The TARGET card carries no highlight, deliberately. The guide's offsets
 * index into the guide's reading; this project may put the term elsewhere in
 * the verse, or render it with another word entirely — which is the very thing
 * the reviewer is here to judge. Guessing a highlight would answer the
 * question the screen is asking.
 */

import type { JSX } from "@solidjs/web";
import BookmarkIcon from "lucide-solid/icons/bookmark";
import SearchIcon from "lucide-solid/icons/search";
import { For, Show, createMemo, createSignal } from "solid-js";

import type { BookId } from "../../../core/book/book";
import type { BookExcerpts, Excerpt, OutlineRow } from "../../../core/excerpts/excerpts";
import type { Analysis } from "../../../core/galley";
import type { Guide, Term } from "../../../core/stet/stet";
import type { EditorBook } from "../../../editor";
import { t } from "../../i18n";
import type { SourceReading } from "../../workflows/stet";
import { Badge, Card, Input, Select, Switch, cx } from "../primitives";
import { ExcerptList } from "./ExcerptList";

export interface StetViewProps {
  readonly terms: readonly Term[];
  readonly selected: string;
  readonly onSelect: (id: string) => void;
  /** The text the term list is filtered by. The URL owns it. */
  readonly filter: string;
  readonly onFilter: (text: string) => void;

  readonly guides: readonly Guide[];
  readonly locale: string;
  readonly onLocale: (locale: string) => void;

  readonly groups: readonly BookExcerpts[];
  readonly outline: readonly OutlineRow[];
  readonly onOpen: (bookId: BookId, from: number, to?: number) => void;
  readonly seat: (bookId: BookId) => Promise<EditorBook | undefined>;
  readonly analyze: (text: string) => Analysis;
  readonly onEdited?: () => void;
  readonly onExpand?: (sid: string, direction: -1 | 1) => void;

  /** The source reading for one excerpt, or nothing when none is bound. */
  readonly sourceOf?: (excerpt: Excerpt) => SourceReading | undefined;
  /** Shown once under the term list: what this screen does not yet keep. */
  readonly note?: string;
  readonly loading?: boolean;
}

const VISIBLE_REFERENCES = 8;

/** `text`, with `spans` wrapped. Spans are sorted and non-overlapping already. */
const highlighted = (text: string, spans: readonly { from: number; to: number }[]): JSX.Element => {
  if (spans.length === 0) return text;
  const out: JSX.Element[] = [];
  let at = 0;
  for (const span of spans) {
    if (span.from > at) out.push(text.slice(at, span.from));
    out.push(
      <mark class="rounded-xs bg-surface-highlight text-on-surface-highlight">
        {text.slice(span.from, span.to)}
      </mark>,
    );
    at = span.to;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
};

export function StetView(props: StetViewProps) {
  const [showAll, setShowAll] = createSignal(false, { name: "stetShowAll" });

  const open = createMemo(() => props.terms.find((term) => term.id === props.selected), {
    name: "stetTerm",
  });

  /** The guide's references for the open term — the whole canon, not this project. */
  const references = createMemo(() => open()?.occurrences.map((held) => held.sid) ?? [], {
    name: "stetReferences",
  });

  /** Occurrences this project actually has: the denominator of the count. */
  const inProject = (): number => props.groups.reduce((sum, entry) => sum + entry.count, 0);

  const shown = createMemo(
    () => {
      const needle = props.filter.trim().toLowerCase();
      if (needle === "") return props.terms;
      return props.terms.filter(
        (term) =>
          term.term.toLowerCase().includes(needle) ||
          term.englishTerm.toLowerCase().includes(needle) ||
          term.glosses.some((gloss) => gloss.toLowerCase().includes(needle)),
      );
    },
    { name: "stetShownTerms" },
  );

  const pair = (excerpt: Excerpt): JSX.Element => {
    const reading = props.sourceOf?.(excerpt);
    return (
      <div class="flex items-start gap-2">
        <BookmarkIcon
          size={14}
          class="mt-0.5 shrink-0 text-on-surface-tertiary"
          aria-hidden="true"
        />
        <div class="min-w-0">
          <span class="text-small font-medium text-on-surface-secondary">
            {t("{ref} —", { ref: excerpt.label })}
          </span>{" "}
          <Show
            when={reading}
            fallback={
              <span class="text-small text-on-surface-tertiary italic">
                {t("No source text bound")}
              </span>
            }
          >
            {(found) => (
              <span class="font-scripture text-small text-on-surface-secondary">
                {highlighted(found().text, found().spans ?? [])}
              </span>
            )}
          </Show>
        </div>
      </div>
    );
  };

  return (
    <div class="flex min-h-0 flex-1 gap-4">
      {/* The guide picker, the filter and the caveat do NOT scroll with the
          hundred terms below them: a reader who has scrolled to "mercy" and
          wants to type a different word should not have to find the box
          again. */}
      <aside class="flex w-72 shrink-0 flex-col gap-2">
        <Show when={props.guides.length > 1}>
          <Select
            size="sm"
            aria-label={t("Key terms guide")}
            value={props.locale}
            onChange={(event) => props.onLocale(event.currentTarget.value)}
          >
            <For each={props.guides}>
              {(guide) => <option value={guide.locale}>{guide.displayName}</option>}
            </For>
          </Select>
        </Show>

        <Input
          type="search"
          size="sm"
          aria-label={t("Filter terms")}
          icon={<SearchIcon size={14} />}
          placeholder={t("Filter terms")}
          value={props.filter}
          onInput={(event) => props.onFilter(event.currentTarget.value)}
        />

        <Show when={props.note !== undefined}>
          <p class="text-smallest text-on-surface-tertiary">{props.note}</p>
        </Show>

        <Show
          when={!(props.loading === true && props.terms.length === 0)}
          fallback={<p class="text-small text-on-surface-tertiary">{t("Loading key terms…")}</p>}
        >
          <Show
            when={shown().length > 0}
            fallback={
              <p class="text-small text-on-surface-tertiary">{t("No term matches that.")}</p>
            }
          >
            <div class="flex min-h-0 flex-col gap-2 overflow-y-auto pe-1">
              <For each={shown()}>
                {(term) => (
                  <Card
                    padded={false}
                    data-term={term.id}
                    class={cx(
                      "cursor-pointer transition-colors",
                      props.selected === term.id
                        ? "border-brand"
                        : "hover:border-surface-border-strong",
                    )}
                    onClick={() => props.onSelect(term.id)}
                  >
                    <div class="flex items-center gap-2 px-3 py-2">
                      <strong class="text-small font-semibold text-on-surface-primary">
                        {term.term}
                      </strong>
                      {/* Only the open term has a count: the others have not been
                        mapped onto the project, and a placeholder pill would
                        read as a zero. */}
                      <Show when={props.selected === term.id}>
                        <Badge tone="brand" class="ms-auto">
                          {t("{done}/{total}", { done: term.done, total: inProject() })}
                        </Badge>
                      </Show>
                    </div>

                    <Show when={props.selected === term.id}>
                      <div class="space-y-2 border-t border-surface-border px-3 py-2">
                        <Show when={term.definition !== ""}>
                          <p class="text-smallest whitespace-pre-line text-on-surface-secondary">
                            {term.definition}
                          </p>
                        </Show>
                        {/* The upstream definition already opens with "This word
                          can mean:", so these are labelled for what they
                          actually are: the surface forms the generator matched
                          in the source, not a second list of senses. */}
                        <Show when={term.glosses.length > 0}>
                          <p class="text-smallest text-on-surface-tertiary">
                            {t("Matched in the source as:")}
                          </p>
                          <ul class="list-disc space-y-0.5 ps-4 text-small text-on-surface-secondary">
                            <For each={term.glosses}>{(gloss) => <li>{gloss}</li>}</For>
                          </ul>
                        </Show>
                        <p class="text-smallest text-on-surface-tertiary">
                          {t("{guide} references, {here} in this project", {
                            guide: references().length,
                            here: inProject(),
                          })}
                        </p>
                        <ul class="space-y-0.5 text-smallest text-on-surface-tertiary">
                          <For
                            each={
                              showAll() ? references() : references().slice(0, VISIBLE_REFERENCES)
                            }
                          >
                            {(label) => <li class="truncate">{label}</li>}
                          </For>
                        </ul>
                        <Show when={references().length > VISIBLE_REFERENCES}>
                          <Switch
                            checked={showAll()}
                            onChange={setShowAll}
                            label={t("Show all references ({count})", {
                              count: references().length,
                            })}
                          />
                        </Show>
                      </div>
                    </Show>
                  </Card>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </aside>

      <ExcerptList
        groups={props.groups}
        outline={props.outline}
        onExpand={props.onExpand}
        onOpen={props.onOpen}
        seat={props.seat}
        analyze={props.analyze}
        onEdited={props.onEdited}
        renderPair={pair}
        empty={
          <p class="text-small text-on-surface-tertiary">
            {t("No occurrence of this term falls in a book this project has.")}
          </p>
        }
      />
    </div>
  );
}
