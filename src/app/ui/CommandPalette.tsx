/**
 * The command palette: a filtered list of the registry's available commands.
 *
 * The whole UI for `src/app/commands.ts` — no separate menu bar, because the
 * palette and the keymap already reach every command, and a third surface
 * would be a third place to forget one.
 */

import { For, Show, createSignal } from "solid-js";

import { availableCommands, runCommand } from "../commands";
import { t } from "../i18n";

export interface PaletteProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function CommandPalette(props: PaletteProps) {
  const [query, setQuery] = createSignal("");

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
        class="palette-backdrop"
        role="presentation"
        onClick={(event) => {
          if (event.target === event.currentTarget) props.onClose();
        }}
      >
        <div class="palette" role="dialog" aria-label={t("Commands")}>
          <input
            type="search"
            autofocus
            placeholder={t("Type a command…")}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") props.onClose();
              if (event.key !== "Enter") return;
              const first = shown()[0];
              if (first !== undefined) choose(first.id);
            }}
          />
          <ul>
            <For each={shown()}>
              {(command) => (
                <li>
                  <button type="button" onClick={() => choose(command.id)}>
                    <span>{command.title}</span>
                    <Show when={command.keys}>{(keys) => <kbd class="spacer">{keys()}</kbd>}</Show>
                  </button>
                </li>
              )}
            </For>
            <Show when={shown().length === 0}>
              <li class="muted">{t("No command matches.")}</li>
            </Show>
          </ul>
        </div>
      </div>
    </Show>
  );
}
