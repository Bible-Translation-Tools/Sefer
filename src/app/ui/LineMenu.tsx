import type { BookEditorMount, LineKind } from "@sefer/editor";
import { For, Show } from "solid-js";

import { m } from "#app/paraglide/messages";

import { Menu, MenuLabel, MenuRadio, MenuSeparator } from "./primitives";
import { nameBlock } from "./workspace/blockNames";

/** Where the menu was asked for: the press's point, and the line under it. */
export interface LineMenuAt {
  readonly x: number;
  readonly y: number;
  readonly offset: number;
  readonly line: LineKind;
}

/**
 * The editor's right-click menu, after Notion's: what this line is, and what
 * it can turn into. Turning only renames the line's marker, so its words stay
 * where they are. Opened at the press's point by an invisible anchor there.
 */
export function LineMenu(props: {
  readonly editor: BookEditorMount;
  readonly at: LineMenuAt;
  readonly onClose: () => void;
}) {
  const close = (): void => {
    props.onClose();
    props.editor.focus();
  };
  return (
    <div class="fixed z-50" style={{ left: `${props.at.x}px`, top: `${props.at.y}px` }}>
      <Menu
        label={m.line_menu_label()}
        open
        onOpenChange={(open) => {
          if (!open) close();
        }}
        side="bottom"
        align="start"
        fitViewport
        trigger={<span class="block size-px" aria-hidden="true" />}
      >
        <MenuLabel>{m.line_menu_current()}</MenuLabel>
        <p class="px-3 pb-2 text-small font-semibold text-on-surface-primary" data-line-kind>
          {nameBlock(props.at.line.kind)}
        </p>
        <MenuSeparator />
        <Show
          when={props.at.line.choices.length > 0}
          fallback={
            <p class="px-3 pb-2 text-small text-on-surface-secondary">{m.line_menu_fixed()}</p>
          }
        >
          <MenuLabel>{m.line_menu_turn_into()}</MenuLabel>
          <For each={props.at.line.choices}>
            {(kind) => (
              <MenuRadio
                data-testid={`line-menu-${kind}`}
                checked={kind === props.at.line.kind}
                onSelect={() => props.editor.turnLineInto(props.at.offset, kind)}
              >
                {nameBlock(kind)}
              </MenuRadio>
            )}
          </For>
        </Show>
      </Menu>
    </div>
  );
}
