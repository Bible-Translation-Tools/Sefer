import { For, Show } from "solid-js";

import type { IncomingBook, IncomingPlan } from "#core/sync";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { bookName } from "../workspace/books";
import { chapterList, planOverlap, planSummary, plural } from "./copy";

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

export function PlanBooks(props: { readonly plan: IncomingPlan; readonly links?: boolean }) {
  const overlap = () => planOverlap(props.plan);
  return (
    <div class="space-y-2" data-plan-books={props.plan.books.length}>
      <p class="text-small text-on-surface-primary" data-plan="summary">
        {planSummary(props.plan)}{" "}
        <Show when={overlap()}>
          {(said) => (
            <span
              class={said().mine ? "text-on-surface-warning" : "text-on-surface-secondary"}
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
