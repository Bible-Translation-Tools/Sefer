/**
 * Translation Notes beside the editor: the notes for the place the reader is
 * standing, following `shell.place` as the caret moves.
 *
 * The pane knows a `Note` — that is the renderer registry's job, to know what
 * it draws — and nothing else of the kind: it asks the handle's `places` slot,
 * through `createHeld`, the one pending policy every resource pane uses, so
 * the notes for the last verse stay on screen while the next verse's load.
 *
 * Each note is its own block, in the order the file has them, with its own
 * quote and its exact Markdown: two notes on one verse are never run
 * together, and a note covering more than the verse says which verses.
 */

import { addressCode, type Address } from "@sefer/text/location/address";
import { Effect } from "effect";
import NotebookText from "lucide-solid/icons/notebook-text";
import { For, Show } from "solid-js";

import type { ResourceHandle } from "#core/resources/kinds/handle";
import type { Note } from "#core/resources/kinds/tn/note";
import type { Resource } from "#core/resources/library";

import { t } from "../../i18n";
import { borrowedContext } from "../../kinds/context";
import { useShell } from "../../ProjectContext";
import { createHeld, DelayedSpinner, EmptyState } from "../primitives";
import { Markdown } from "./Markdown";

export interface NotesPaneProps {
  readonly resource: Resource;
  readonly handle: ResourceHandle<Note>;
}

interface Question {
  readonly handle: ResourceHandle<Note>;
  readonly place: Address;
}

export function NotesPane(props: NotesPaneProps) {
  const shell = useShell();
  const context = borrowedContext(shell.services);

  const held = createHeld(
    (): Question | undefined => {
      const place = shell.place();
      return place === undefined ? undefined : { handle: props.handle, place };
    },
    ({ handle, place }) =>
      // The registry hands this pane only a handle that has `places`; the
      // fallback is the type's, never taken.
      handle.places === undefined ? Effect.succeed([]) : handle.places.at(place, context),
    (a, b) => a.handle === b.handle && addressCode(a.place) === addressCode(b.place),
  );

  /**
   * Which place the notes on screen answer: the one asked, once it has
   * answered. Not `shell.place()`, which moves first: while the next verse's
   * notes load, the last verse's stay, and so does its name.
   */
  const answeredPlace = (): Address | undefined => held.answered()?.place;
  const label = (): string => {
    const place = answeredPlace();
    return place === undefined ? "" : shell.location.label(place);
  };

  const placeCode = (): string => {
    const place = answeredPlace();
    return place === undefined ? "" : addressCode(place);
  };

  return (
    <section
      aria-label={props.resource.title}
      data-testid="notes-pane"
      data-place={placeCode()}
      data-notes={held.value()?.length ?? -1}
      class="flex min-h-0 flex-1 flex-col gap-3"
    >
      <header class="flex items-baseline gap-2 px-1">
        <h3 class="min-w-0 flex-1 truncate text-small font-semibold text-on-surface-primary">
          {label() || props.resource.title}
        </h3>
        {/* Read-only is the ABSENCE of the edit slot, said once. */}
        <Show when={props.handle.edit === undefined}>
          <span class="shrink-0 text-smallest text-on-surface-tertiary">{t("Read only")}</span>
        </Show>
      </header>

      <Show
        when={shell.place() !== undefined}
        fallback={
          <EmptyState
            icon={<NotebookText size={22} />}
            title={t("No verse yet")}
            description={t("Put the caret in a verse to read its notes.")}
          />
        }
      >
        <Show
          when={held.failure() === undefined}
          fallback={
            <p data-testid="notes-unavailable" class="px-1 text-small text-on-surface-tertiary">
              {held.failure()?.description}
            </p>
          }
        >
          <Show when={held.value()} fallback={<DelayedSpinner />}>
            {(notes) => (
              <Show
                when={notes().length > 0}
                fallback={
                  <p data-testid="notes-none" class="px-1 text-small text-on-surface-tertiary">
                    {t("No notes for {place}.", { place: label() })}
                  </p>
                }
              >
                <ol class="flex min-h-0 flex-col gap-3 overflow-y-auto pe-1">
                  <For each={notes()}>
                    {(note) => (
                      <li
                        data-testid="note"
                        data-address={addressCode(note.address)}
                        class="rounded-2xl bg-surface-primary p-4"
                      >
                        <Show when={note.quote}>
                          {(quote) => (
                            <Markdown
                              inline
                              class="text-small font-semibold text-on-surface-primary"
                              text={quote()}
                            />
                          )}
                        </Show>
                        <Show
                          when={
                            note.openEnded === true ||
                            addressCode(note.address) !==
                              addressCode(answeredPlace() ?? note.address)
                          }
                        >
                          <p class="text-smallest text-on-surface-tertiary">
                            {note.openEnded === true
                              ? t("From {place} to the chapter's end", {
                                  place: shell.location.label(note.address),
                                })
                              : shell.location.label(note.address)}
                          </p>
                        </Show>
                        <Markdown
                          class="note-body mt-2 text-small text-on-surface-secondary"
                          text={note.body}
                        />
                      </li>
                    )}
                  </For>
                </ol>
              </Show>
            )}
          </Show>
        </Show>
      </Show>
    </section>
  );
}
