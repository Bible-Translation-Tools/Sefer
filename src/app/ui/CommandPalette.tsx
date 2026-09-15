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

import { For, Show, createEffect, createSignal } from "solid-js";

import { availableCommands, runCommand } from "../commands";
import { t } from "../i18n";
import { Kbd } from "./primitives";

export interface PaletteProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function CommandPalette(props: PaletteProps) {
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

  const choose = (id: string): void => {
    props.onClose();
    setQuery("");
    runCommand(id);
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
            <Show when={shown().length === 0}>
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
