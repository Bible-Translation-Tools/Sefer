/**
 * What a pull would change, in books and chapters, BEFORE it runs.
 *
 * This card is the reason `/cloud` exists rather than a Pull button. A
 * translator asked to accept "3 incoming commits" has been asked nothing at
 * all; a translator told "3 chapters of Mark changed in the shared project,
 * and one of them also changed here" has been asked a real question they can
 * answer.
 *
 * A contested book — one both sides changed — is never merged and never
 * offered as part of a pull. Its row links to Compare instead, by path string
 * (`/compare?book=MRK`) rather than by import, because Compare is another
 * screen with its own lifetime and this card must not depend on it having
 * been built.
 */

import { For, Show } from "solid-js";

import type { IncomingBook, IncomingPlan } from "../../../core/sync";
import { t } from "../../i18n";
import { Badge, Card, PanelHeader } from "../primitives";
import { bookName } from "../workspace/books";
import { chapterList, planSummary } from "./copy";

/**
 * The link to the Compare screen, as a path string.
 *
 * Another agent owns `/compare`; naming it by URL is the whole coupling. If
 * the route is not there yet the link 404s honestly, which is better than this
 * card importing a module that may not exist.
 */
export const compareHref = (bookId: string): string =>
  `/compare?book=${encodeURIComponent(bookId)}`;

function BookRow(props: { readonly book: IncomingBook }) {
  const name = () => bookName(props.book.bookId);
  return (
    <li
      class="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t border-surface-border px-1 py-2 first:border-t-0"
      data-plan-book={props.book.bookId}
      data-contested={props.book.contested}
    >
      <strong class="text-small">{name()}</strong>
      <span class="text-small text-on-surface-secondary">
        {t("{chapters} changed in the shared project", {
          chapters: chapterList(props.book.chapters),
        })}
      </span>
      <Show when={props.book.alsoHere.length > 0}>
        <span class="text-small text-on-surface-secondary">
          {t("· {chapters} also changed here", {
            chapters: chapterList(props.book.alsoHere),
          })}
        </span>
      </Show>
      <Show
        when={props.book.contested}
        fallback={
          <Badge class="ms-auto" tone="success">
            {t("safe to receive")}
          </Badge>
        }
      >
        <a
          class="ms-auto text-small font-medium text-brand underline underline-offset-2"
          href={compareHref(props.book.bookId)}
          data-compare-link={props.book.bookId}
        >
          {t("Compare {book}", { book: name() })}
        </a>
      </Show>
    </li>
  );
}

export function IncomingPlanCard(props: { readonly plan: IncomingPlan }) {
  return (
    <Card class="space-y-3" data-cloud-card="plan">
      <PanelHeader
        level={3}
        title={t("What would arrive")}
        actions={
          <Badge tone={props.plan.clean ? "success" : "warning"}>
            {props.plan.clean ? t("nothing of yours moves") : t("needs your decision")}
          </Badge>
        }
      />
      <p class="text-small text-on-surface-secondary" data-plan="summary">
        {planSummary(props.plan)}
      </p>

      <Show when={props.plan.books.length > 0}>
        <ul
          class="rounded-md border border-surface-border"
          data-plan-books={props.plan.books.length}
        >
          <For each={props.plan.books}>{(book) => <BookRow book={book} />}</For>
        </ul>
      </Show>

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
            {t("{count} version(s) in the shared project", { count: props.plan.commits.length })}
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
