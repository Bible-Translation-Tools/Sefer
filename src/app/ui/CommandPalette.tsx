import type { Address } from "@sefer/text/location/address";
import { For, Show, createEffect, createMemo, createSignal } from "solid-js";

import { availableCommands, runCommand } from "../commands";
import { t } from "../i18n";
import { useShell } from "../ProjectContext";
import { Kbd } from "./primitives";

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

  const place = createMemo(() => {
    if (shown().length > 0) return undefined;
    if (shell.project() === undefined) return undefined;
    const citation = shell.location.read(query());
    const first: Address | undefined = citation.ok ? citation.addresses[0] : undefined;
    if (first === undefined) return undefined;
    return { address: first, label: shell.location.label(first) };
  });

  const choose = (id: string): void => {
    props.onClose();
    setQuery("");
    runCommand(id);
  };

  const go = (): void => {
    const found = place();
    if (found === undefined) return;
    props.onClose();
    setQuery("");
    shell.showReference(found.address);
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
                    <span>{t("Go to {place}", { place: found().label })}</span>
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
