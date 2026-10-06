/**
 * What a pull would change, in books and chapters, BEFORE it runs.
 *
 * This card is the reason `/cloud` exists rather than a Pull button. A
 * translator asked to accept "3 incoming commits" has been asked nothing at
 * all; a translator told "There are changes to 3 verses in 2 books. You also
 * changed 1 of those verses." has been asked a real question they can answer.
 *
 * A contested book — one both sides changed — is never merged and never
 * offered as part of a pull. Its row links to the project's Review screen
 * instead, by path string rather than by import, so this card does not depend
 * on that screen's module.
 */

import { For, Show } from "solid-js";

import type { IncomingBook, IncomingPlan } from "#core/sync";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Card, PanelHeader } from "../primitives";
import { bookName } from "../workspace/books";
import { chapterList, planOverlap, planSummary, plural } from "./copy";

/**
 * The link to this project's Review screen, as a path string. Review takes no
 * book in its URL (a picked source has no address), so the link opens the
 * screen and the reader picks the book there.
 */
const reviewHref = (slug: string): string =>
  `/project/${encodeURIComponent(slug)}/review?against=shared`;

function BookRow(props: { readonly book: IncomingBook; readonly links: boolean }) {
  const shell = useShell();
  const name = () => bookName(props.book.bookId);
  return (
    <li
      class="flex flex-wrap items-baseline gap-x-2 gap-y-1 py-1"
      data-plan-book={props.book.bookId}
      data-contested={props.book.contested}
    >
      <span class="text-small font-medium text-on-surface-primary">{name()}</span>
      <span class="text-small text-on-surface-secondary">
        {props.book.verses === 0
          ? chapterList(props.book.chapters)
          : plural(props.book.verses, "{count} verse", "{count} verses")}
      </span>
      <Show when={props.book.versesAlsoHere > 0}>
        <span class="text-small text-on-surface-warning">
          {t("· {count} you also changed", { count: props.book.versesAlsoHere })}
        </span>
      </Show>
      <Show when={props.links && props.book.contested}>
        <a
          class="ms-auto text-small font-medium text-brand underline-offset-2 hover:underline"
          href={reviewHref(shell.slug())}
          data-compare-link={props.book.bookId}
        >
          {t("Compare {book}", { book: name() })}
        </a>
      </Show>
    </li>
  );
}

/**
 * The two sentences and the books, one line each: what changed in the shared
 * project, whether any of it is yours too, and where. Colour carries the one
 * thing that matters — a verse you both changed — and nothing else.
 */
export function PlanBooks(props: {
  readonly plan: IncomingPlan;
  /** Each contested book links to Review; off where a button below already goes there. */
  readonly links?: boolean;
}) {
  const overlap = () => planOverlap(props.plan);
  return (
    <div class="space-y-2" data-plan-books={props.plan.books.length}>
      <p class="text-small text-on-surface-primary" data-plan="summary">
        {planSummary(props.plan)}{" "}
        <Show when={overlap()}>
          {(said) => (
            <span
              class={said().mine ? "text-on-surface-warning" : "text-on-surface-success"}
              data-plan="overlap"
            >
              {said().text}
            </span>
          )}
        </Show>
      </p>
      <Show when={props.plan.books.length > 0}>
        <ul>
          <For each={props.plan.books}>
            {(book) => <BookRow book={book} links={props.links === true} />}
          </For>
        </ul>
      </Show>
    </div>
  );
}

export function IncomingPlanCard(props: { readonly plan: IncomingPlan }) {
  return (
    <Card class="space-y-3" data-cloud-card="plan">
      <PanelHeader level={3} title={t("Incoming changes")} />
      <PlanBooks plan={props.plan} links />

      <Show when={!props.plan.clean}>
        <p class="text-small text-on-surface-secondary">
          {t(
            "Sefer never merges scripture text on its own. The books you both changed stay exactly as they are here until you compare them and choose.",
          )}
        </p>
      </Show>

      <Show when={props.plan.commits.length > 0}>
        <details class="text-small text-on-surface-tertiary">
          <summary class="cursor-pointer">
            {plural(
              props.plan.commits.length,
              "{count} version in the shared project",
              "{count} versions in the shared project",
            )}
          </summary>
          <ul class="mt-2 space-y-1 ps-4">
            <For each={props.plan.commits}>
              {(commit) => (
                <li class="truncate">
                  {commit.message} — {commit.author.name}
                </li>
              )}
            </For>
          </ul>
        </details>
      </Show>
    </Card>
  );
}
