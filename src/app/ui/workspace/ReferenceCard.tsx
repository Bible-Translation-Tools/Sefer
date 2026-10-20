import { Effect, Option } from "effect";
import { Show, createEffect, createSignal } from "solid-js";

import { tocViewOf, type Analysis } from "#core/galley";
import type { Resource } from "#core/resources/library";

import { t } from "../../i18n";
import { useShell } from "../../ProjectContext";
import { ExcerptReader } from "../excerpts/ExcerptReader";
import { cardPolicy } from "../multibuffer/policy";
import { bookName } from "./books";
import { metadataOf } from "./project";

const VERSES = 4;

export interface ReferenceCardProps {
  readonly resource: Resource;
  readonly bookId: string;
  readonly language: string;
  readonly onOpen: () => void;
}

export function ReferenceCard(props: ReferenceCardProps) {
  const shell = useShell();
  const { services } = shell;
  const [preview, setPreview] = createSignal<
    { readonly analysis: Analysis; readonly from: number; readonly to: number } | undefined
  >(undefined, { name: "referenceCardPreview" });

  createEffect(
    () => ({ id: props.resource.id, book: props.bookId }),
    ({ id, book }) => {
      setPreview(undefined);
      void services
        .run(Effect.option(services.library.readBook(id, book)))
        // oxlint-disable-next-line solid/reactivity
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
      <div data-reference-preview class="pointer-events-none max-h-36 overflow-hidden">
        <Show
          when={preview()}
          fallback={
            <p class="text-small text-on-surface-primary">
              {t("{title} has no {book}", {
                title: props.resource.title,
                book: bookName(props.bookId, metadataOf(shell.project())),
              })}
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
