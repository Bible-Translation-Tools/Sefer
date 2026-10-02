/**
 * Every button on a card, as one contract.
 *
 * A screen says WHAT a card lets the reader do — an action's id, its words,
 * whether it is a toggle and whether it is pressed — and the frame draws it.
 * Nobody hand-builds a card button, so every one is the same size, reads the
 * same when pressed (`aria-pressed`, which `Button` styles), has an accessible
 * name, and answers to one selector: `data-card-action="<id>"`.
 *
 * Two kinds, because an icon without words must say what it does another way:
 * `icon` takes its `label` as the accessible name and tooltip, and must have
 * an icon; `button` shows its words and may lead with an icon.
 */

import { Dynamic, type JSX } from "@solidjs/web";
import { For, Show, type Accessor } from "solid-js";

import { Button, IconButton } from "../primitives";

/** A lucide icon, or anything drawn the same way. */
export type CardIcon = (props: { readonly size?: number }) => JSX.Element;

interface ActionBase {
  /** Stable, for `data-card-action`: "edit", "usfm", "fix:empty-paragraph". */
  readonly id: string;
  /** The words — shown on a `button`, the accessible name of an `icon`. */
  readonly label: string;
  /** A toggle's state. Absent is not a toggle. */
  readonly pressed?: boolean;
  /** A native tooltip, for a button whose words need one ("Stop editing (Escape)"). */
  readonly title?: string;
  /** Shown and not pressable: History's Adopt where your text already reads that way. */
  readonly disabled?: boolean;
  readonly onPress: () => void;
}

export type CardAction =
  | (ActionBase & {
      readonly kind: "button";
      readonly icon?: CardIcon;
      /** How loud: primary for the one thing to do now (Done), tertiary for quiet. */
      readonly emphasis?: "primary" | "secondary" | "tertiary";
    })
  | (ActionBase & { readonly kind: "icon"; readonly icon: CardIcon });

const pressedOf = (action: CardAction): "true" | "false" | undefined =>
  action.pressed === undefined ? undefined : action.pressed ? "true" : "false";

/**
 * One action, drawn — and kept: the button is made once per action id and
 * reads its current words and pressed state from `action`, so pressing a
 * toggle from the keyboard leaves focus on the button it pressed. (Drawn from
 * each new action object, the button was replaced and focus went with it.)
 */
export function CardActionButton(props: {
  readonly action: Accessor<CardAction>;
  /** `sm` in a card's footer; `md`, the app's control size, where a screen draws them itself. */
  readonly size?: "sm" | "md";
}): JSX.Element {
  const asIcon = () => {
    const action = props.action();
    return action.kind === "icon" ? action : undefined;
  };
  const asButton = () => {
    const action = props.action();
    return action.kind === "button" ? action : undefined;
  };
  return (
    <>
      <Show when={asIcon()}>
        {(action) => (
          <IconButton
            size={props.size ?? "sm"}
            label={action().label}
            icon={<Dynamic component={action().icon} />}
            aria-pressed={pressedOf(action())}
            disabled={action().disabled}
            data-card-action={action().id}
            onClick={() => action().onPress()}
          />
        )}
      </Show>
      <Show when={asButton()}>
        {(action) => (
          <Button
            size={props.size ?? "sm"}
            variant={action().emphasis ?? "secondary"}
            icon={action().icon === undefined ? undefined : <Dynamic component={action().icon} />}
            aria-pressed={pressedOf(action())}
            title={action().title}
            disabled={action().disabled}
            data-card-action={action().id}
            onClick={() => action().onPress()}
          >
            {action().label}
          </Button>
        )}
      </Show>
    </>
  );
}

/** A run of actions, in order, one button per id. */
export function CardActions(props: {
  readonly actions: readonly CardAction[];
  readonly size?: "sm" | "md";
}): JSX.Element {
  return (
    <For each={props.actions} keyed={(action) => action.id}>
      {(action) => <CardActionButton action={action} size={props.size} />}
    </For>
  );
}
