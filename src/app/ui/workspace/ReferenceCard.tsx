/**
 * One installed reference text, folded down to a card: the opening verses of
 * the open book in that text, fading out, then its language and its title.
 * What Refine's reference column shows when it is collapsed — a stack of these
 * — and pressing one opens the column on that text.
 *
 * The verses are the engine's, not read here: the book is analysed (Galley)
 * and its table of contents names where the first verses start and end, then
 * the excerpt reader draws that span as the editor would, verse pips and all.
 * Sefer reads no designator itself (`documentation/architecture/location.md`).
 */

import { Effect, Option } from "effect";
import { Show, createEffect, createSignal } from "solid-js";

import { tocViewOf, type Analysis } from "#core/galley";
import type { Resource } from "#core/resources/library";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { ExcerptReader } from "../excerpts/ExcerptReader";
import { cardPolicy } from "../multibuffer/policy";

/** How many verses a card shows before it fades: enough to recognise the text. */
const VERSES = 4;

export interface ReferenceCardProps {
  readonly resource: Resource;
  readonly bookId: string;
  /** Its language's name ("English"). */
  readonly language: string;
  readonly onOpen: () => void;
}

export function ReferenceCard(props: ReferenceCardProps) {
  const { services } = useShell();
  const [preview, setPreview] = createSignal<
    { readonly analysis: Analysis; readonly from: number; readonly to: number } | undefined
  >(undefined, { name: "referenceCardPreview" });

  // Read when the card is drawn, and again for another text or book: a card
  // is a glance, so it does not follow edits.
  createEffect(
    () => ({ id: props.resource.id, book: props.bookId }),
    ({ id, book }) => {
      setPreview(undefined);
      void services
        .run(Effect.option(services.library.readBook(id, book)))
        // oxlint-disable-next-line solid/reactivity -- a promise continuation: runs once, when the book is read
        .then((read) => {
          const text = Option.flatten(read);
          if (Option.isNone(text)) return;
          const analysis = services.galley.analyze(text.value, "reference.preview");
          const verses = tocViewOf(analysis).verses;
          const first = verses[0];
          if (first === undefined) return;
          setPreview({
            analysis,
            from: first.at,
            to: verses[VERSES]?.at ?? analysis.text.length,
          });
        });
    },
  );

  return (
    <button
      type="button"
      data-testid={`reference-card-${props.resource.id}`}
      class="flex w-full cursor-pointer flex-col gap-3 rounded-2xl bg-surface-primary p-4.5 text-start transition-colors hover:bg-surface-secondary"
      onClick={() => props.onOpen()}
    >
      {/* The opening verses, fading out: a taste of the text, not the text. */}
      <div data-reference-preview class="pointer-events-none max-h-36 overflow-hidden">
        <Show
          when={preview()}
          fallback={
            <p class="text-small text-on-surface-primary">
              {t("{title} has no {book}", { title: props.resource.title, book: props.bookId })}
            </p>
          }
        >
          {(held) => (
            <ExcerptReader
              analysis={held().analysis}
              span={{ from: held().from, to: held().to }}
              policy={cardPolicy("regular")}
              marks={[]}
              label={`reference-card:${props.resource.id}`}
            />
          )}
        </Show>
      </div>
      <span class="block h-px bg-surface-border" aria-hidden="true" />
      <span class="flex min-w-0 flex-col">
        <span class="truncate text-h4 font-semibold text-on-surface-primary">{props.language}</span>
        <span class="truncate text-small text-on-surface-secondary">{props.resource.title}</span>
      </span>
    </button>
  );
}
