/**
 * What a pull would change, in books and chapters, BEFORE it runs.
 *
 * This list is why the cloud popover says more than "Pull". A translator
 * asked to accept "3 incoming commits" has been asked nothing at all; a
 * translator told "There are changes to 3 verses in 2 books. You also changed
 * 1 of those verses." has been asked a real question they can answer.
 *
 * A contested book — one both sides changed — is never merged and never
 * offered as part of a pull. Its row can link to the project's Review screen
 * instead, by path string rather than by import, so this list does not depend
 * on that screen's module. The popover draws it without the links: its own
 * "See the changes" already goes there.
 *
 * Only the list is left of the card the file is named for, which went with
 * `/cloud` (2026-10-06).
 */

import { For, Show } from "solid-js";

import type { IncomingBook, IncomingPlan } from "#core/sync";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
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
