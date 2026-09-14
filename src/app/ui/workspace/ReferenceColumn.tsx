/**
 * The reference column: the texts this project is being translated FROM and
 * ALONGSIDE, at the passage the editor is showing.
 *
 * Everything comes from `Library` (src/core/resources/library.ts): `resolve`
 * answers which resources a project binds to a role, and `lookup` answers one
 * reference out of one of them. Both are Effects, so the column loads
 * asynchronously and says so — the editor never waits on a reference text.
 *
 * `source` and `reference` are shown together and labelled, because the
 * distinction is the project's (which text is authoritative) and not the
 * reader's (both are things to look at while translating). A project that
 * binds neither gets the empty state rather than an empty column: no reference
 * text is a state with a next action, not a blank.
 */

import { useNavigate } from "@tanstack/solid-router";
import { Effect, Option, Result } from "effect";
import BookMarked from "lucide-solid/icons/book-marked";
import { For, Show, createEffect, createSignal } from "solid-js";

import type { Ref } from "../../../core/book/book";
import type { Resource, Role } from "../../../core/resources/library";
import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { Button, Card, EmptyState, cx } from "../primitives";

/** The roles the column shows, in the order it shows them. */
const ROLES: readonly Role[] = ["source", "reference"];

interface Entry {
  readonly resource: Resource;
  readonly role: Role;
  /** The passage at the editor's current place; empty when there is none. */
  readonly text: string;
}

export function ReferenceColumn() {
  const navigate = useNavigate();
  const shell = useShell();
  const [entries, setEntries] = createSignal<readonly Entry[]>([], { name: "referenceEntries" });
  const [loading, setLoading] = createSignal(true, { name: "referenceLoading" });
  const [expanded, setExpanded] = createSignal<string | undefined>(undefined, {
    name: "referenceExpanded",
  });

  /**
   * What the column is showing: the focused book, and the chapter the editor
   * is clipped to (the first, when it is showing the whole book — a reference
   * pane has to point somewhere, and the top of the book is where the reader
   * starts).
   */
  const place = (): Ref | undefined => {
    const book = shell.focused();
    const project = shell.project();
    if (book === undefined || project === undefined) return undefined;
    return { book: book.id, chapter: (shell.chapter() ?? 0) + 1 };
  };

  // One pass per project/place: resolve the bindings, then look up the passage
  // in each. Re-running on the place is the point — the cards follow the
  // editor.
  createEffect(
    () => ({ project: shell.project()?.id, at: place() }),
    ({ project, at }) => {
      if (project === undefined) {
        setEntries([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      void shell.services
        .run(
          Effect.gen(function* () {
            const library = shell.services.library;
            const found: Entry[] = [];
            for (const role of ROLES) {
              for (const resource of yield* library.resolve(project, role)) {
                // `Effect.result` rather than a failure channel: a resource
                // with no file for this book is the ordinary case, and the
                // card for it says so instead of taking the column down.
                const looked =
                  at === undefined
                    ? undefined
                    : yield* Effect.result(library.lookup(resource.id, at));
                const passage =
                  looked !== undefined && Result.isSuccess(looked)
                    ? Option.getOrUndefined(looked.success)
                    : undefined;
                found.push({ resource, role, text: passage?.text ?? "" });
              }
            }
            return found;
          }),
        )
        .then((found: readonly Entry[]) => {
          setEntries(found);
          setLoading(false);
        });
    },
  );

  return (
    <aside
      aria-label={t("Reference texts")}
      class="flex h-full min-w-0 flex-col gap-3 overflow-y-auto p-4"
      data-references={entries().length}
    >
      <Show when={!loading() || entries().length > 0}>
        <Show
          when={entries().length > 0}
          fallback={
            <EmptyState
              class="bg-surface-primary"
              icon={<BookMarked size={22} />}
              title={t("No reference texts yet")}
              description={t(
                "Bind a source or reference resource to this project to read beside it.",
              )}
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void navigate({ to: "/projects" });
                  }}
                >
                  {t("Add reference")}
                </Button>
              }
            />
          }
        >
          <For each={entries()}>
            {(entry) => (
              <Card
                data-resource={entry.resource.id}
                class="cursor-pointer transition-colors hover:border-brand/40"
                onClick={() =>
                  setExpanded((held) =>
                    held === entry.resource.id ? undefined : entry.resource.id,
                  )
                }
              >
                <p
                  class={cx(
                    "font-scripture text-small text-on-surface-secondary",
                    expanded() === entry.resource.id ? undefined : "line-clamp-4",
                  )}
                >
                  <Show when={entry.text !== ""} fallback={t("Nothing here for this passage.")}>
                    {entry.text}
                  </Show>
                </p>
                <hr class="my-3 border-surface-border" />
                <p class="text-small font-bold text-on-surface-primary">{entry.resource.title}</p>
                <p class="text-smallest text-on-surface-tertiary">
                  {entry.resource.subject ??
                    (entry.role === "source" ? t("Source") : t("Reference"))}
                </p>
              </Card>
            )}
          </For>
        </Show>
      </Show>
    </aside>
  );
}
