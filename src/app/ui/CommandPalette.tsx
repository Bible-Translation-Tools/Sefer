/**
 * The command palette: a filtered list of the registry's available commands.
 *
 * The whole UI for `src/app/commands.ts` — no separate menu bar, because the
 * palette and the keymap already reach every command, and a third surface
 * would be a third place to forget one.
 *
 * Not the `Dialog` primitive, deliberately. A palette opens on a chord from
 * anywhere and closes on Escape or a click outside, and it owns its own input
 * focus; wrapping it in a modal would add a focus trap and a scroll lock it
 * does not want, and would put its open state in two places.
 */

import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import type { Reference } from "../../core/reference/reference";
import { parseReference } from "../../core/reference/reference";
import { availableCommands, runCommand } from "../commands";
import { t } from "../i18n";
import { useShell } from "../ProjectContext";
import { Kbd } from "./primitives";
import { bookName, lookupFor } from "./workspace/books";
import { metadataOf } from "./workspace/project";

/** "Luke", "Luke 3", "Luke 3:1" — only as much as was actually named. */
const referenceLabel = (found: Reference & { readonly label: string }): string => {
  if (found.chapter === undefined) return found.label;
  if (found.verse === undefined) return `${found.label} ${found.chapter}`;
  return `${found.label} ${found.chapter}:${found.verse}`;
};

export interface PaletteProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function CommandPalette(props: PaletteProps) {
  const shell = useShell();
  const [query, setQuery] = createSignal("");
  const [box, setBox] = createSignal<HTMLInputElement | undefined>(undefined, {
    name: "paletteInput",
  });

  /**
   * The input takes focus every time the palette opens.
   *
   * `autofocus` is not enough and never was: the attribute is honoured when the
   * browser PARSES an element, and this one is created by Solid long after the
   * page loaded, so it did nothing at all. A palette you have to click before
   * you can type is a palette that failed at the one thing it is for.
   *
   * `props.open` is read in an effect rather than in a ref callback because the
   * element outlives one opening: `<Show>` keeps it mounted while open, and the
   * reader may close and reopen without the component being rebuilt.
   */
  createEffect(
    () => ({ open: props.open, input: box() }),
    ({ open, input }) => {
      if (!open || input === undefined) return;
      input.focus();
      input.select();
    },
  );

  const shown = () =>
    availableCommands().filter((command) =>
      command.title.toLowerCase().includes(query().trim().toLowerCase()),
    );

  /**
   * A place, when what was typed is one and no command answers to it.
   *
   * ONLY when no command matches, and that order is the whole design. "find"
   * is a command and also the start of no book; "job" is a book and could
   * easily become a word in some command's title. A reader who typed the name
   * of a command they can see in the list means the command, always — so the
   * reference is what the palette falls back to, never what it prefers.
   *
   * The parser is the same one the sidebar and the book picker use
   * (`core/reference`), so "luk 3", "Lucas 3:1" and "1 john 2" mean the same
   * thing everywhere in the application.
   */
  const place = createMemo(() => {
    if (shown().length > 0) return undefined;
    const project = shell.project();
    if (project === undefined) return undefined;
    const found = parseReference(query(), lookupFor(project, metadataOf(project)));
    if (found === undefined) return undefined;
    return { ...found, label: bookName(found.bookId, metadataOf(project)) };
  });

  const choose = (id: string): void => {
    props.onClose();
    setQuery("");
    runCommand(id);
  };

  /** Go where the text pointed, and say so the way the reader wrote it. */
  const go = (): void => {
    const found = place();
    if (found === undefined) return;
    props.onClose();
    setQuery("");
    shell.showReference(found);
  };

  return (
    <Show when={props.open}>
      <div
        class="fixed inset-0 z-40 flex justify-center bg-surface-overlay pt-[12vh]"
        role="presentation"
        data-testid="palette"
        onClick={(event) => {
          if (event.target === event.currentTarget) props.onClose();
        }}
        /* Escape closes from anywhere inside the palette, not only from the
           input: arrowing into the list moves focus onto a button, and a reader
           who then presses Escape means the same thing. */
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          props.onClose();
        }}
      >
        <div
          class="flex h-fit max-h-[60vh] w-[min(36rem,90vw)] flex-col overflow-hidden rounded-xl border border-surface-border bg-surface-primary shadow-large"
          role="dialog"
          aria-label={t("Commands")}
        >
          <input
            type="search"
            ref={setBox}
            data-testid="palette-input"
            class="border-b border-surface-border bg-transparent px-4 py-3 text-h4 text-on-surface-primary placeholder:text-on-surface-tertiary focus:outline-none"
            placeholder={t("Type a command…")}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              const first = shown()[0];
              if (first !== undefined) choose(first.id);
              else go();
            }}
          />
          <ul class="overflow-auto py-1">
            <For each={shown()}>
              {(command) => (
                <li>
                  <button
                    type="button"
                    class="flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-start text-small text-on-surface-primary hover:bg-surface-secondary"
                    onClick={() => choose(command.id)}
                  >
                    <span>{command.title}</span>
                    <Show when={command.keys}>{(keys) => <Kbd class="ms-auto">{keys()}</Kbd>}</Show>
                  </button>
                </li>
              )}
            </For>
            <Show when={place()}>
              {(found) => (
                <li>
                  <button
                    type="button"
                    data-testid="palette-reference"
                    class="flex w-full cursor-pointer items-center gap-2 px-4 py-2 text-start text-small text-on-surface-primary hover:bg-surface-secondary"
                    onClick={go}
                  >
                    <span>{t("Go to {place}", { place: referenceLabel(found()) })}</span>
                    <Kbd class="ms-auto">{t("Enter")}</Kbd>
                  </button>
                </li>
              )}
            </Show>
            <Show when={shown().length === 0 && place() === undefined}>
              <li class="px-4 py-2 text-small text-on-surface-tertiary">
                {t("No command matches.")}
              </li>
            </Show>
          </ul>
        </div>
      </div>
    </Show>
  );
}
